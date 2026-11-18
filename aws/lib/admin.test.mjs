import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

process.env.TABLE_NAME = "blyp-test";
process.env.ADMIN_EMAIL = "founder@blyp.test";
process.env.ADMIN_JWT_SECRET = "x".repeat(48);
process.env.REALTIME_WS_API_ENDPOINT = "";

const { installFakeDynamo } = await import("./testing/fakeDynamo.mjs");

const { store, keyOf } = await installFakeDynamo();

const time = await import("./adminTime.mjs");
const auth = await import("./adminAuth.mjs");
const adminStore = await import("./adminStore.mjs");
const metrics = await import("./adminMetrics.mjs");
const notify = await import("./adminNotify.mjs");
const recap = await import("./adminRecap.mjs");
const actions = await import("./adminActions.mjs");
const { renderDashboard } = await import("../handlers/admin/dashboard.mjs");
const { renderInvestorReport } = await import("../handlers/admin/report.mjs");

beforeEach(() => store.clear());

const at = (iso) => iso;
let seq = 0;
const ev = (type, userId, isoAt, data = {}) => ({
  id: `evt-${String(++seq).padStart(6, "0")}-aaaa`,
  type,
  userId,
  at: isoAt,
  data,
});
const profile = (over = {}) => ({
  userId: "u1",
  firstName: "Awa",
  lastName: "N.",
  phone: "+237691234567",
  transactionPinHash: "x",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

/* -------------------------------------------------------------------------- */

describe("calendrier Cameroun (UTC+1)", () => {
  test("le jour bascule à 23:00 UTC", () => {
    assert.equal(time.dayKey(Date.parse("2026-11-17T22:59:59Z")), "2026-11-17");
    assert.equal(time.dayKey(Date.parse("2026-11-17T23:00:00Z")), "2026-11-18");
  });
  test("lundi de la semaine, mois, bornes", () => {
    assert.equal(time.weekKey(Date.parse("2026-11-18T12:00:00Z")), "2026-11-16"); // mercredi -> lundi 16
    assert.equal(time.weekKey(Date.parse("2026-11-16T00:30:00Z")), "2026-11-16");
    assert.equal(time.weekKey(Date.parse("2026-11-22T22:30:00Z")), "2026-11-16"); // dimanche soir
    assert.equal(time.monthBounds("2026-02").to, "2026-02-28");
    assert.equal(time.prevMonth("2026-01"), "2025-12");
    assert.equal(time.daysBetween("2026-11-01", "2026-11-08"), 7);
  });
});

describe("authentification admin", () => {
  test("scrypt : bon mot de passe accepté, mauvais refusé, format sans $", async () => {
    const h = await auth.hashPassword("Correct-Horse-Battery-9");
    assert.ok(!h.includes("$"));
    assert.equal(await auth.verifyPassword("Correct-Horse-Battery-9", h), true);
    assert.equal(await auth.verifyPassword("correct-horse-battery-9", h), false);
    assert.equal(await auth.verifyPassword("x", "garbage"), false);
  });

  test("TOTP : vecteurs RFC 6238 (SHA-1)", () => {
    const secret = auth.base32Encode(Buffer.from("12345678901234567890"));
    assert.equal(auth.totpCode(secret, 59_000), "287082");
    assert.equal(auth.totpCode(secret, 1_111_111_109_000), "081804");
    assert.equal(auth.totpCode(secret, 1_234_567_890_000), "005924");
  });

  test("TOTP : fenêtre ±1 pas, pas de code faux, base32 aller-retour", () => {
    const secret = auth.generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = auth.totpCode(secret, now);
    assert.notEqual(auth.matchTotp(secret, code, now), null);
    assert.notEqual(auth.matchTotp(secret, code, now + 30_000), null);
    assert.equal(auth.matchTotp(secret, code, now + 120_000), null);
    assert.equal(auth.matchTotp(secret, "12345", now), null);
    assert.equal(auth.base32Encode(auth.base32Decode(secret)), secret);
  });

  test("jetons : session ≠ élévation, secret / audience vérifiés", async () => {
    const cfg = auth.adminConfig();
    const session = await auth.signSession(cfg);
    const elev = await auth.signElevation(cfg);
    assert.ok(await auth.verifySession(session, cfg));
    assert.equal(await auth.verifySession(elev, cfg), null);
    assert.equal(await auth.verifyElevation(session, cfg), null);
    assert.ok(await auth.verifyElevation(elev, cfg));
    assert.equal(await auth.verifySession(`${session}x`, cfg), null);
  });

  test("verrouillage après 5 échecs", async () => {
    for (let i = 0; i < 4; i++) {
      assert.equal((await auth.recordFailure()).locked, false);
    }
    assert.equal((await auth.recordFailure()).locked, true);
    assert.ok((await auth.lockRemainingSec()) > 0);
    await auth.clearFailures();
    assert.equal(await auth.lockRemainingSec(), 0);
  });

  test("un code TOTP ne sert qu'une fois par usage", async () => {
    const secret = auth.generateTotpSecret();
    const pass = "Another-Strong-Pass-1";
    const cfg = {
      ...auth.adminConfig(),
      emails: ["founder@blyp.test", "second@blyp.test"],
      email: "founder@blyp.test",
      passwordHash: await auth.hashPassword(pass),
      totpSecret: secret,
    };
    const totp = auth.totpCode(secret);
    const first = await auth.checkCredentials({ email: cfg.email, password: pass, totp, purpose: "login" }, cfg);
    assert.equal(first.ok, true);
    const replay = await auth.checkCredentials({ email: cfg.email, password: pass, totp, purpose: "login" }, cfg);
    assert.equal(replay.ok, false);
    const second = await auth.checkCredentials(
      { email: "SECOND@blyp.test", password: pass, totp: auth.totpCode(secret, Date.now() + 30_000), purpose: "login" },
      cfg,
    );
    assert.equal(second.ok, true);
    assert.equal(second.email, "second@blyp.test");
    const session = await auth.signSession(cfg, second.email);
    assert.equal((await auth.verifySession(session, cfg)).sub, "second@blyp.test");
    const bad = await auth.checkCredentials({ email: "x@y.z", password: pass, totp: "000000", purpose: "login" }, cfg);
    assert.equal(bad.ok, false);
  });
});

describe("journal d'événements et statistiques", () => {
  test("inscription : événement unique, compteurs, doublon SQS ignoré", async () => {
    const e = ev("signup", "u1", "2026-11-18T09:00:00.000Z", { completedBy: "pin" });
    const a = await adminStore.ingestEvent(e, profile({ createdAt: "2026-11-18T09:00:00.000Z" }));
    const b = await adminStore.ingestEvent(e, profile());
    assert.equal(a.stored, true);
    assert.equal(b.stored, false);
    const [day] = await adminStore.dailyStats("2026-11-18", "2026-11-18");
    assert.equal(day.n_signup, 1);
    assert.equal(day.activeUsers, 1);
    assert.equal((await adminStore.totals()).users, 1);
  });

  test("paiement : GMV, activation unique, commerçant actif", async () => {
    const p = profile();
    await adminStore.ingestEvent(ev("payment", "u1", "2026-11-18T10:00:00Z", { amountFcfa: 1500, commerceId: "c1" }), p);
    await adminStore.ingestEvent(ev("payment", "u1", "2026-11-18T11:00:00Z", { amountFcfa: 500, commerceId: "c1" }), p);
    await adminStore.ingestEvent(ev("transfer", "u1", "2026-11-18T12:00:00Z", { amountFcfa: 1000 }), p);
    const [d] = await adminStore.dailyStats("2026-11-18", "2026-11-18");
    assert.equal(d.n_payment, 2);
    assert.equal(d.v_payment, 2000);
    assert.equal(d.activatedUsers, 1);
    assert.equal(d.activeMerchants, 1);
    assert.equal(d.activeUsers, 1);
    const derived = metrics.derive(d, 1);
    assert.equal(derived.gmvFcfa, 3000);
    assert.equal(derived.txCount, 3);
    assert.equal(derived.avgTicketFcfa, 1000);
  });

  test("reconstitution d'historique : même transaction / inscription jamais comptée deux fois", async () => {
    const p = profile();
    await adminStore.ingestEvent(ev("deposit", "u1", "2026-11-18T10:00:00Z", { amountFcfa: 2000, transactionId: "tx-9" }), p);
    await adminStore.ingestEvent({ id: "bf-tx-9", type: "deposit", userId: "u1", at: "2026-11-18T10:00:00Z", data: { amountFcfa: 2000, transactionId: "tx-9" } }, p);
    await adminStore.ingestEvent(ev("signup", "u1", "2026-11-18T09:00:00Z"), p);
    await adminStore.ingestEvent({ id: "bf-signup-u1", type: "signup", userId: "u1", at: "2026-11-18T09:00:00Z", data: {} }, p);
    const [d] = await adminStore.dailyStats("2026-11-18", "2026-11-18");
    assert.equal(d.n_deposit, 1);
    assert.equal(d.v_deposit, 2000);
    assert.equal(d.n_signup, 1);
    assert.equal((await adminStore.totals()).users, 1);
  });

  test("ouvertures rapprochées dédoublonnées (45 s)", async () => {
    const p = profile();
    await adminStore.ingestEvent(ev("app_open", "u1", "2026-11-18T10:00:00.000Z"), p);
    const dup = await adminStore.ingestEvent(ev("app_open", "u1", "2026-11-18T10:00:20.000Z"), p);
    const later = await adminStore.ingestEvent(ev("app_open", "u1", "2026-11-18T10:02:00.000Z"), p);
    assert.equal(dup.stored, false);
    assert.equal(later.stored, true);
    assert.equal((await adminStore.dailyStats("2026-11-18", "2026-11-18"))[0].n_app_open, 2);
  });

  test("utilisateur sans PIN (inscription incomplète) non compté comme actif", async () => {
    await adminStore.ingestEvent(ev("login", "u2", "2026-11-18T10:00:00Z"), profile({ userId: "u2", transactionPinHash: null }));
    const [d] = await adminStore.dailyStats("2026-11-18", "2026-11-18");
    assert.equal(d.n_login, 1);
    assert.equal(d.activeUsers ?? 0, 0);
  });

  test("rétention J+1 comptée une fois par cohorte", async () => {
    const p = profile({ createdAt: "2026-11-10T10:00:00Z" });
    await adminStore.ingestEvent(ev("signup", "u1", "2026-11-10T10:00:00Z"), p);
    await adminStore.ingestEvent(ev("login", "u1", "2026-11-11T09:00:00Z"), p);
    await adminStore.ingestEvent(ev("app_open", "u1", "2026-11-11T15:00:00Z"), p);
    const [c] = await adminStore.cohorts("2026-11-10", "2026-11-10");
    assert.equal(c.size, 1);
    assert.equal(c.d1, 1);
  });

  test("flux : récents d'abord, puis nouveautés depuis un curseur", async () => {
    const p = profile();
    await adminStore.ingestEvent(ev("login", "u1", "2026-11-18T08:00:00Z"), p);
    await adminStore.ingestEvent(ev("message", "u1", "2026-11-18T08:05:00Z", { kind: "text" }), p);
    const first = await adminStore.listEvents({ now: Date.parse("2026-11-18T09:00:00Z"), limit: 10 });
    assert.deepEqual(first.items.map((i) => i.type), ["message", "login"]);
    await adminStore.ingestEvent(ev("payment", "u1", "2026-11-18T08:30:00Z", { amountFcfa: 100 }), p);
    const next = await adminStore.listEvents({ since: first.cursor, now: Date.parse("2026-11-18T09:00:00Z") });
    assert.deepEqual(next.items.map((i) => i.type), ["payment"]);
  });

  test("rapport de période : comparaison à la période précédente", async () => {
    const p = profile();
    await adminStore.ingestEvent(ev("payment", "u1", "2026-11-17T10:00:00Z", { amountFcfa: 1000, commerceId: "c1" }), p);
    await adminStore.ingestEvent(ev("payment", "u1", "2026-11-18T10:00:00Z", { amountFcfa: 3000, commerceId: "c1" }), p);
    const r = await metrics.periodReport("2026-11-18", "2026-11-18", { withTop: true });
    assert.equal(r.current.gmvFcfa, 3000);
    assert.equal(r.previousValues.gmvFcfa, 1000);
    assert.equal(r.delta.gmvFcfa, 200);
    assert.equal(r.top.merchants[0].volumeFcfa, 3000);
  });

  test("ajustement admin et suppression alimentent le suivi du float", async () => {
    await adminStore.ingestEvent(ev("admin_action", "u1", "2026-11-18T10:00:00Z", { ledgerDeltaFcfa: 5000 }), profile());
    await adminStore.ingestEvent(ev("deposit", "u1", "2026-11-18T10:05:00Z", { amountFcfa: 10000 }), profile());
    await adminStore.ingestEvent(ev("admin_action", "u1", "2026-11-18T10:06:00Z", { ledgerDeltaFcfa: -2000 }), profile());
    const t = await adminStore.totals();
    assert.equal(metrics.expectedFloat(t), 13000);
  });
});

describe("récaps", () => {
  test("lundi => jour + semaine ; le 1er => jour + mois ; autre jour => jour seul", () => {
    assert.deepEqual(recap.recapPeriods("2026-11-18").map((p) => p.kind), ["daily"]);
    const monday = recap.recapPeriods("2026-11-16");
    assert.deepEqual(monday.map((p) => p.kind), ["daily", "weekly"]);
    assert.equal(monday[1].from, "2026-11-09");
    assert.equal(monday[1].to, "2026-11-15");
    const first = recap.recapPeriods("2026-12-01");
    assert.deepEqual(first.map((p) => p.kind), ["daily", "monthly"]);
    assert.equal(first[1].from, "2026-11-01");
    assert.equal(first[1].to, "2026-11-30");
    const both = recap.recapPeriods("2026-06-01"); // lundi ET 1er
    assert.deepEqual(both.map((p) => p.kind), ["daily", "weekly", "monthly"]);
  });
});

describe("notifications", () => {
  test("les données utilisateur sont échappées dans l'email HTML", () => {
    const item = {
      id: "evt-1",
      type: "signup",
      at: "2026-11-18T09:00:00Z",
      name: '<img src=x onerror="alert(1)">',
      phone: "+237691234567",
      data: {},
    };
    const d = notify.describeEvent(item);
    const html = notify.renderEmailHtml({ heading: d.title, intro: d.summary, lines: d.lines });
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img"));
  });

  test("les messages ne contiennent jamais de contenu", () => {
    const d = notify.describeEvent({
      id: "e", type: "message", at: "2026-11-18T09:00:00Z", name: "Awa", phone: "+237691234567",
      data: { kind: "text", toName: "Paul", body: "secret" },
    });
    assert.ok(!JSON.stringify(d).includes("secret"));
  });
});

describe("export CSV", () => {
  test("neutralise l'injection de formules et échappe les guillemets", () => {
    const out = metrics.toCsv([{ a: '=HYPERLINK("x")', b: 'dit "oui"', c: 5, d: "+cmd" }]);
    assert.ok(out.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(out.includes('"dit ""oui"""'));
    assert.ok(out.includes("'+cmd"));
    assert.ok(out.startsWith("\uFEFF"));
  });
});

describe("actions souveraines", () => {
  const seed = async (balance = 10_000) => {
    const id = "11111111-1111-4111-8111-111111111111";
    store.set(keyOf(`USER#${id}`, "PROFILE"), {
      PK: `USER#${id}`, SK: "PROFILE", userId: id, firstName: "Awa", lastName: "N.",
      phone: "+237691234567", transactionPinHash: "h", accountId: "BLYP-U-ABC",
    });
    store.set(keyOf(`USER#${id}`, "BALANCE"), { PK: `USER#${id}`, SK: "BALANCE", balanceFcfa: balance });
    return id;
  };
  const params = (id, over = {}) => ({
    userId: id, direction: "credit", amountFcfa: 2500, reason: "Geste commercial",
    idempotencyKey: "idem-key-0001", admin: "founder@blyp.test", ...over,
  });

  test("crédit : solde + historique + idempotence (rejouer ne double pas)", async () => {
    const id = await seed(10_000);
    const a = await actions.adjustBalance(params(id));
    assert.equal(a.ok, true);
    assert.equal(a.balanceAfterFcfa, 12_500);
    const again = await actions.adjustBalance(params(id));
    assert.equal(again.reused, true);
    assert.equal(store.get(keyOf(`USER#${id}`, "BALANCE")).balanceFcfa, 12_500);
    const txs = [...store.values()].filter((i) => String(i.SK).startsWith("TX#"));
    assert.equal(txs.length, 1);
    assert.equal(txs[0].type, "ADMIN_CREDIT");
  });

  test("débit : refusé si solde insuffisant, rien n'est modifié", async () => {
    const id = await seed(1_000);
    const r = await actions.adjustBalance(params(id, { direction: "debit", amountFcfa: 5_000, idempotencyKey: "idem-key-0002" }));
    assert.equal(r.error, "INSUFFICIENT_BALANCE");
    assert.equal(store.get(keyOf(`USER#${id}`, "BALANCE")).balanceFcfa, 1_000);
    assert.equal([...store.values()].filter((i) => String(i.SK).startsWith("TX#")).length, 0);
  });

  test("validation : montant, motif, clé", async () => {
    const id = await seed();
    assert.equal((await actions.adjustBalance(params(id, { amountFcfa: 0 }))).error, "AMOUNT_INVALID");
    assert.equal((await actions.adjustBalance(params(id, { amountFcfa: 99_999_999 }))).error, "AMOUNT_INVALID");
    assert.equal((await actions.adjustBalance(params(id, { reason: "" }))).error, "REASON_REQUIRED");
    assert.equal((await actions.adjustBalance(params(id, { idempotencyKey: "x" }))).error, "IDEMPOTENCY_REQUIRED");
    assert.equal((await actions.adjustBalance(params("nope"))).error, "USER_NOT_FOUND");
  });
});

describe("page web", () => {
  test("CSP : pas de style/handler inline, nonce partout, rien d'injecté", () => {
    const page = renderDashboard({ nonce: "NONCE123", configured: true });
    assert.ok(!/\sstyle=/.test(page), "attribut style inline interdit");
    assert.ok(!/\son[a-z]+=/i.test(page), "handler inline interdit");
    assert.ok(!/<script(?![^>]*nonce=)/.test(page));
    assert.ok(!/<style(?![^>]*nonce=)/.test(page));
    assert.ok(page.includes('<script nonce="NONCE123">'));
  });

  test("rapport investisseur : rendu sans données et échappement", () => {
    const overview = {
      generatedAt: "2026-11-18T09:00:00.000Z", day: "2026-11-18",
      totals: { users: 3, deletedUsers: 0, activatedUsers: 1, payingMerchants: 1, gmvFcfa: 4000, txCount: 3, depositVolumeFcfa: 10000, withdrawalVolumeFcfa: 0, messages: 5 },
      actives: { dau: 2, wau: 3, mau: 3, stickiness: 0.66 }, activationRate: 0.33, month: { key: "2026-11" },
      last7: { newUsers: 3, gmvFcfa: 4000 }, last30: { newUsers: 3, gmvFcfa: 4000 },
    };
    const html = renderInvestorReport({
      nonce: "N", overview,
      monthly: [{ month: "<b>2026-11</b>", newUsers: 3, mau: 3, txCount: 3, gmvFcfa: 4000, avgTicketFcfa: 1333, depositVolumeFcfa: 10000, messages: 5 }],
      cohorts: [],
    });
    assert.ok(!html.includes("<b>2026-11</b>"));
    assert.ok(html.includes("Définitions et méthodologie"));
  });
});
