import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

process.env.TABLE_NAME = "blyp-test";
process.env.STAGE = "dev";
process.env.ADMIN_EMAIL = "founder@blyp.test";
process.env.ADMIN_JWT_SECRET = "j".repeat(48);
process.env.REALTIME_WS_API_ENDPOINT = "";
delete process.env.ADMIN_EVENTS_QUEUE_URL;

const { installFakeDynamo } = await import("./testing/fakeDynamo.mjs");
const { store, keyOf } = await installFakeDynamo();
const auth = await import("./adminAuth.mjs");
const { handler } = await import("../handlers/admin/index.mjs");

const PASSWORD = "Founder-Password-2026";
const secret = auth.generateTotpSecret();
process.env.ADMIN_PASSWORD_HASH = await auth.hashPassword(PASSWORD);
process.env.ADMIN_TOTP_SECRET = secret;

/**
 * Code TOTP valide, jamais rejoué : login et élévation ont chacun leur registre anti-rejeu ;
 * on décale d'un pas (0, -1, +1) pour obtenir plusieurs codes distincts dans la fenêtre ±1.
 */
const used = { login: 0, elevation: 0 };
function freshCode(purpose = "login") {
  const offset = [0, -1, 1][used[purpose]++];
  assert.notEqual(offset, undefined, "plus de code TOTP distinct disponible dans ce test");
  return auth.totpCode(secret, Date.now() + offset * 30_000);
}

function req(method, path, { body, cookie, headers = {}, query } = {}) {
  return handler({
    rawPath: `/dev${path}`,
    requestContext: { http: { method, sourceIp: "203.0.113.9" }, stage: "dev", domainName: "api.test" },
    headers: { "x-requested-with": "blyp-admin", ...headers },
    cookies: cookie ? [cookie] : [],
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = (res) => JSON.parse(res.body);

async function login() {
  const res = await req("POST", "/admin/api/login", {
    body: { email: "founder@blyp.test", password: PASSWORD, totp: freshCode() },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.cookies[0].split(";")[0];
}
async function elevate(cookie) {
  const res = await req("POST", "/admin/api/elevate", {
    cookie,
    body: { password: PASSWORD, totp: freshCode("elevation") },
  });
  assert.equal(res.statusCode, 200, res.body);
  return json(res).elevation;
}

beforeEach(async () => {
  used.login = 0;
  used.elevation = 0;
  store.clear();
  await auth.clearFailures();
});

const seedUser = (id, { balance = 0, phone = "+237691234567", first = "Awa" } = {}) => {
  store.set(keyOf(`USER#${id}`, "PROFILE"), {
    PK: `USER#${id}`, SK: "PROFILE", userId: id, firstName: first, lastName: "N.", phone,
    transactionPinHash: "h", accountId: "BLYP-U-TEST", createdAt: "2026-11-01T10:00:00Z",
  });
  store.set(keyOf(`USER#${id}`, "BALANCE"), { PK: `USER#${id}`, SK: "BALANCE", balanceFcfa: balance });
  store.set(keyOf(`PHONE#${phone}`, "META"), { PK: `PHONE#${phone}`, SK: "META", userId: id });
};
const UID = "22222222-2222-4222-8222-222222222222";

describe("tableau de bord — HTTP", () => {
  test("la page est servie avec une CSP stricte et des en-têtes de sécurité", async () => {
    const res = await req("GET", "/admin");
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["Content-Security-Policy"], /script-src 'nonce-[^']+'/);
    assert.match(res.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.equal(res.headers["X-Frame-Options"], "DENY");
    assert.match(res.headers["Cache-Control"], /no-store/);
  });

  test("API fermée sans session, y compris l'aperçu", async () => {
    for (const p of ["/admin/api/overview", "/admin/api/events", "/admin/api/users", "/admin/api/audit"]) {
      assert.equal((await req("GET", p)).statusCode, 401, p);
    }
  });

  test("connexion : mauvais code → 401 générique, bon → cookie HttpOnly/Secure/Strict", async () => {
    const bad = await req("POST", "/admin/api/login", {
      body: { email: "founder@blyp.test", password: PASSWORD, totp: "000000" },
    });
    assert.equal(bad.statusCode, 401);
    assert.ok(!bad.body.includes("mot de passe") || bad.body.includes("invalides"));
    const res = await req("POST", "/admin/api/login", {
      body: { email: "founder@blyp.test", password: PASSWORD, totp: freshCode() },
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.cookies[0], /HttpOnly/);
    assert.match(res.cookies[0], /Secure/);
    assert.match(res.cookies[0], /SameSite=Strict/);
  });

  test("5 échecs → verrouillage (429), même avec les bons identifiants", async () => {
    for (let i = 0; i < 5; i++) {
      await req("POST", "/admin/api/login", { body: { email: "founder@blyp.test", password: "nope", totp: "000000" } });
    }
    const res = await req("POST", "/admin/api/login", {
      body: { email: "founder@blyp.test", password: PASSWORD, totp: freshCode() },
    });
    assert.equal(res.statusCode, 429);
  });

  test("CSRF : une écriture sans l'en-tête personnalisé est refusée", async () => {
    const cookie = await login();
    const res = await req("PUT", "/admin/api/settings", {
      cookie, body: { notify: {} }, headers: { "x-requested-with": "" },
    });
    assert.equal(res.statusCode, 401);
  });

  test("liste blanche d'IP respectée", async () => {
    process.env.ADMIN_ALLOWED_IPS = "198.51.100.1";
    try {
      assert.equal((await req("GET", "/admin")).statusCode, 403);
    } finally {
      delete process.env.ADMIN_ALLOWED_IPS;
    }
  });

  test("action sensible sans élévation → 403 ; avec élévation → exécutée et auditée", async () => {
    seedUser(UID, { balance: 1000 });
    const cookie = await login();
    const body = { direction: "credit", amountFcfa: 2000, reason: "Remboursement", idempotencyKey: "idem-http-0001" };

    const denied = await req("POST", `/admin/api/users/${UID}/balance`, { cookie, body });
    assert.equal(denied.statusCode, 403);
    assert.equal(json(denied).code, "ELEVATION_REQUIRED");

    const token = await elevate(cookie);
    const ok = await req("POST", `/admin/api/users/${UID}/balance`, {
      cookie, body, headers: { "x-admin-elevation": token },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(json(ok).balanceAfterFcfa, 3000);

    /** Rejouer la même requête (double clic / retry réseau) ne double pas le crédit. */
    const replay = await req("POST", `/admin/api/users/${UID}/balance`, {
      cookie, body, headers: { "x-admin-elevation": token },
    });
    assert.equal(json(replay).reused, true);
    assert.equal(store.get(keyOf(`USER#${UID}`, "BALANCE")).balanceFcfa, 3000);

    const audit = json(await req("GET", "/admin/api/audit", { cookie })).items;
    assert.ok(audit.some((a) => a.action === "balance_credit" && a.result === "ok"));
    assert.ok(audit.some((a) => a.action === "elevation"));
  });

  test("le jeton de session ne vaut pas jeton d'élévation", async () => {
    seedUser(UID, { balance: 1000 });
    const cookie = await login();
    const sessionToken = cookie.split("=")[1];
    const res = await req("POST", `/admin/api/users/${UID}/balance`, {
      cookie,
      body: { direction: "credit", amountFcfa: 10, reason: "test", idempotencyKey: "idem-http-0002" },
      headers: { "x-admin-elevation": sessionToken },
    });
    assert.equal(res.statusCode, 403);
  });

  test("suppression : numéro de confirmation, solde, archive conservée", async () => {
    seedUser(UID, { balance: 5000 });
    const cookie = await login();
    const token = await elevate(cookie);
    const h = { "x-admin-elevation": token };

    const wrong = await req("POST", `/admin/api/users/${UID}/delete`, {
      cookie, headers: h, body: { confirmPhone: "600000000", reason: "fraude" },
    });
    assert.equal(json(wrong).code, "CONFIRM_PHONE_MISMATCH");

    const withBalance = await req("POST", `/admin/api/users/${UID}/delete`, {
      cookie, headers: h, body: { confirmPhone: "691234567", reason: "fraude" },
    });
    assert.equal(json(withBalance).code, "BALANCE_NOT_ZERO");
    assert.ok(store.has(keyOf(`USER#${UID}`, "PROFILE")));

    const done = await req("POST", `/admin/api/users/${UID}/delete`, {
      cookie, headers: h, body: { confirmPhone: "691234567", reason: "fraude", forfeitBalance: true },
    });
    assert.equal(done.statusCode, 200, done.body);
    assert.ok(!store.has(keyOf(`USER#${UID}`, "PROFILE")));
    assert.ok(!store.has(keyOf("PHONE#+237691234567", "META")));
    const archive = store.get(keyOf(`ADELETED#${UID}`, "ARCHIVE"));
    assert.equal(archive.balanceFcfa, 5000);
    assert.equal(archive.profile.hasPin, true);
    assert.ok(!JSON.stringify(archive).includes("transactionPinHash"));
  });

  test("création d'un utilisateur par l'admin", async () => {
    const cookie = await login();
    const token = await elevate(cookie);
    const res = await req("POST", "/admin/api/users", {
      cookie,
      headers: { "x-admin-elevation": token },
      body: { phone: "699887766", firstName: "Paul", lastName: "Biya" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const created = json(res);
    const profile = store.get(keyOf(`USER#${created.userId}`, "PROFILE"));
    assert.equal(profile.firstName, "Paul");
    assert.equal(profile.createdByAdmin, true);
    assert.equal(profile.transactionPinHash, undefined);

    const dup = await req("POST", "/admin/api/users", {
      cookie,
      headers: { "x-admin-elevation": await elevate(cookie) },
      body: { phone: "699887766", firstName: "Paul", lastName: "Biya" },
    });
    assert.equal(dup.statusCode, 400);
  });

  test("recherche d'utilisateurs : le hash du PIN n'est jamais renvoyé", async () => {
    seedUser(UID, { balance: 42 });
    const cookie = await login();
    const res = await req("GET", "/admin/api/users", { cookie, query: { q: "awa" } });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.users.length, 1);
    assert.ok(!res.body.includes("transactionPinHash"));
    assert.ok(!res.body.includes('"h"'));
  });

  test("export CSV : en-têtes de téléchargement et trace d'audit", async () => {
    const cookie = await login();
    const res = await req("GET", "/admin/api/export/events.csv", {
      cookie, query: { from: "2026-11-01", to: "2026-11-02" },
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["Content-Type"], /text\/csv/);
    assert.match(res.headers["Content-Disposition"], /attachment/);
    const tooLong = await req("GET", "/admin/api/export/events.csv", {
      cookie, query: { from: "2026-01-01", to: "2026-11-02" },
    });
    assert.equal(tooLong.statusCode, 400);
  });

  test("réglages d'alertes : valeurs nettoyées et persistées", async () => {
    const cookie = await login();
    const put = await req("PUT", "/admin/api/settings", {
      cookie, body: { notify: { app_open: { push: false, email: false }, bogus: { push: true } }, emailPerMinuteCap: 99999 },
    });
    assert.equal(put.statusCode, 200);
    const got = json(await req("GET", "/admin/api/settings", { cookie }));
    assert.equal(got.notify.app_open.push, false);
    assert.equal(got.notify.bogus, undefined);
    assert.equal(got.emailPerMinuteCap, 200);
  });

  test("non configuré → API 503 mais la page reste affichable", async () => {
    const saved = process.env.ADMIN_PASSWORD_HASH;
    process.env.ADMIN_PASSWORD_HASH = "";
    try {
      assert.equal((await req("GET", "/admin")).statusCode, 200);
      assert.equal((await req("GET", "/admin/api/overview")).statusCode, 503);
    } finally {
      process.env.ADMIN_PASSWORD_HASH = saved;
    }
  });
});

describe("app admin mobile", () => {
  test("login renvoie un jeton Bearer utilisable sans cookie", async () => {
    const res = await req("POST", "/admin/api/login", {
      body: { email: "founder@blyp.test", password: PASSWORD, totp: freshCode() },
    });
    assert.equal(res.statusCode, 200, res.body);
    const token = json(res).token;
    assert.equal(typeof token, "string");
    assert.ok(token.length > 20);
    const me = await req("GET", "/admin/api/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(json(me).admin, "founder@blyp.test");
  });

  test("enregistrement d'un jeton push admin", async () => {
    const cookie = await login();
    const bad = await req("POST", "/admin/api/device", {
      cookie,
      body: { token: "not-a-token", platform: "android" },
    });
    assert.equal(bad.statusCode, 400);
    const ok = await req("POST", "/admin/api/device", {
      cookie,
      body: {
        token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        platform: "android",
        deviceId: "redmi-test",
      },
    });
    assert.equal(ok.statusCode, 200, ok.body);
  });
});
