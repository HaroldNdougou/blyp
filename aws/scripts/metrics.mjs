/**
 * Indicateurs de traction Blyp (usage interne / investisseurs).
 *   npm run aws:metrics            → rapport console
 *   npm run aws:metrics -- --json metrics.json
 * Lecture seule (Scan). Ne lit jamais PIN / OTP / tokens.
 * À grande échelle : remplacer le Scan par des agrégats (DynamoDB Streams → compteurs jour).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { writeFileSync } from "node:fs";

const TABLE = process.env.TABLE_NAME?.trim() || "blyp-dev";
const REGION = process.env.AWS_REGION?.trim() || "af-south-1";
/** Douala = UTC+1 : jours / semaines calés sur l’heure locale. */
const TZ_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 8;
const MONTHS = 6;

/** Actions faites par l’utilisateur lui-même (un paiement reçu n’est pas une action). */
const ACTION_TX = new Set([
  "PAYMENT",
  "MONEY_SEND",
  "DEPOSIT",
  "MONEY_CLAIM",
  "MONEY_RECALL",
  "POCKET_IN",
  "POCKET_OUT",
]);
const VOLUME_TX = {
  PAYMENT: "Paiements proximité",
  MONEY_SEND: "Message Money",
  DEPOSIT: "Rechargements",
};

const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
);

async function scanAll() {
  const items = [];
  let key;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        ProjectionExpression:
          "PK, SK, #t, amountFcfa, createdAt, senderUserId, entityType, firstName, balanceFcfa, userId",
        ExpressionAttributeNames: { "#t": "type" },
        ExclusiveStartKey: key,
      }),
    );
    items.push(...(res.Items ?? []));
    key = res.LastEvaluatedKey;
  } while (key);
  return items;
}

const localMs = (iso) => Date.parse(iso) + TZ_OFFSET_MS;

function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS;
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const fmtDay = (ms) => new Date(ms).toISOString().slice(5, 10).split("-").reverse().join("/");
const fmtF = (n) => `${Math.round(n).toLocaleString("fr-FR")} F`;
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
const growth = (cur, prev) =>
  prev > 0 ? `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)} %` : "—";

function compute(items) {
  const nowLocal = Date.now() + TZ_OFFSET_MS;
  const thisWeek = weekStart(nowLocal);
  const weeks = Array.from({ length: WEEKS }, (_, i) => thisWeek - (WEEKS - 1 - i) * 7 * DAY_MS);

  const signupAt = new Map();
  let profilesComplete = 0;
  const activity = new Map();
  const volume = {};
  const pocketUsers = new Set();
  let pocketTotal = 0;
  let messages7d = 0;

  const touch = (userId, ms) => {
    if (!userId) return;
    let s = activity.get(userId);
    if (!s) activity.set(userId, (s = []));
    s.push(ms);
  };

  for (const it of items) {
    const pk = String(it.PK ?? "");
    const sk = String(it.SK ?? "");
    if (!pk.startsWith("USER#") && !pk.startsWith("CONV#")) continue;
    const userId = pk.startsWith("USER#") ? pk.slice(5) : null;
    if (userId?.startsWith("test-")) continue;

    if (userId && sk === "PROFILE") {
      if (it.createdAt) signupAt.set(userId, localMs(it.createdAt));
      if (String(it.firstName ?? "").trim()) profilesComplete++;
    } else if (userId && sk.startsWith("TX#") && it.createdAt) {
      const ms = localMs(it.createdAt);
      const type = String(it.type ?? "");
      if (ACTION_TX.has(type)) touch(userId, ms);
      if (VOLUME_TX[type]) {
        const amt = Number(it.amountFcfa ?? 0);
        const v = (volume[type] ??= { months: {}, weeks: {}, count30: 0, sum30: 0 });
        const mk = monthKey(ms);
        v.months[mk] = (v.months[mk] ?? 0) + amt;
        const wk = weekStart(ms);
        v.weeks[wk] = (v.weeks[wk] ?? 0) + amt;
        if (nowLocal - ms <= 30 * DAY_MS) {
          v.count30++;
          v.sum30 += amt;
        }
      }
    } else if (userId && sk.startsWith("POCKET#")) {
      const bal = Number(it.balanceFcfa ?? 0);
      pocketTotal += bal;
      pocketUsers.add(userId);
    } else if (pk.startsWith("CONV#") && it.entityType === "MESSAGE" && it.createdAt) {
      const ms = localMs(it.createdAt);
      touch(String(it.senderUserId ?? ""), ms);
      if (nowLocal - ms <= 7 * DAY_MS) messages7d++;
    }
  }

  const activeWithin = (days) => {
    let n = 0;
    for (const list of activity.values()) {
      if (list.some((ms) => nowLocal - ms <= days * DAY_MS)) n++;
    }
    return n;
  };
  const activeInWeek = (wk) => {
    const set = new Set();
    for (const [u, list] of activity) {
      if (list.some((ms) => ms >= wk && ms < wk + 7 * DAY_MS)) set.add(u);
    }
    return set;
  };

  const weekly = weeks.map((wk) => {
    let signups = 0;
    for (const ms of signupAt.values()) if (ms >= wk && ms < wk + 7 * DAY_MS) signups++;
    return { week: wk, active: activeInWeek(wk).size, signups };
  });

  const cohorts = weeks.slice(0, -1).map((wk) => {
    const members = [...signupAt].filter(([, ms]) => ms >= wk && ms < wk + 7 * DAY_MS).map(([u]) => u);
    const ret = [];
    for (let k = 1; k <= 4; k++) {
      const target = wk + k * 7 * DAY_MS;
      if (target > thisWeek) break;
      const act = activeInWeek(target);
      ret.push(members.filter((u) => act.has(u)).length);
    }
    return { week: wk, size: members.length, retained: ret };
  });

  const months = Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(nowLocal);
    return monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (MONTHS - 1 - i), 1));
  });

  return {
    generatedAt: new Date().toISOString(),
    table: TABLE,
    users: {
      total: signupAt.size,
      profilesComplete,
      dau: activeWithin(1),
      wau: activeWithin(7),
      mau: activeWithin(30),
    },
    weekly,
    cohorts,
    volume: Object.fromEntries(
      Object.entries(VOLUME_TX).map(([type, label]) => {
        const v = volume[type] ?? { months: {}, weeks: {}, count30: 0, sum30: 0 };
        return [
          type,
          {
            label,
            count30d: v.count30,
            sum30d: v.sum30,
            months: months.map((m) => ({ month: m, sum: v.months[m] ?? 0 })),
            weeks: weeks.map((wk) => ({ week: wk, sum: v.weeks[wk] ?? 0 })),
          },
        ];
      }),
    ),
    pockets: { users: pocketUsers.size, totalFcfa: pocketTotal },
    messages7d,
  };
}

function print(m) {
  const line = (s = "") => console.log(s);
  const u = m.users;
  line(`\n═══ BLYP — TRACTION (${m.table}) — ${new Date(m.generatedAt).toLocaleString("fr-FR")} ═══\n`);
  line("UTILISATEURS");
  line(`  Inscrits ............ ${u.total}   (profil complété : ${u.profilesComplete})`);
  line(`  Actifs aujourd’hui .. ${u.dau}`);
  line(`  Actifs 7 jours ...... ${u.wau}   (${pct(u.wau, u.total)} des inscrits)`);
  line(`  Actifs 30 jours ..... ${u.mau}   (${pct(u.mau, u.total)} des inscrits)`);
  line(`  Fidélité (actifs 7j / 30j) : ${pct(u.wau, u.mau)}`);

  line("\nPAR SEMAINE (lundi)        actifs   inscriptions");
  m.weekly.forEach((w, i) => {
    const prev = m.weekly[i - 1];
    const g = prev ? growth(w.active, prev.active) : "";
    line(`  ${fmtDay(w.week)} ............... ${String(w.active).padStart(5)}   ${String(w.signups).padStart(5)}   ${g}`);
  });

  line("\nRÉTENTION PAR COHORTE (inscrits la semaine X, encore actifs à S+1…S+4)");
  for (const c of m.cohorts) {
    if (c.size === 0) continue;
    const cells = c.retained.map((n) => pct(n, c.size).padStart(6)).join(" ");
    line(`  ${fmtDay(c.week)}  (${String(c.size).padStart(3)} inscrits) ${cells}`);
  }

  line("\nVOLUME (FCFA)");
  for (const v of Object.values(m.volume)) {
    line(`  ${v.label} — 30 jours : ${fmtF(v.sum30d)} (${v.count30d} opérations)`);
    line(`    par mois : ${v.months.map((x) => `${x.month.slice(5)}/${x.month.slice(2, 4)} ${fmtF(x.sum)}`).join(" · ")}`);
    const w = v.weeks;
    line(`    cette semaine : ${fmtF(w[w.length - 1].sum)} (${growth(w[w.length - 1].sum, w[w.length - 2].sum)} vs semaine dernière)`);
  }

  line("\nPOCHES");
  line(`  Utilisateurs avec poche : ${m.pockets.users} — total mis de côté : ${fmtF(m.pockets.totalFcfa)}`);
  line(`\nMESSAGES envoyés (7 jours) : ${m.messages7d}\n`);
}

const items = await scanAll();
const metrics = compute(items);
print(metrics);

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx > 0) {
  const out = process.argv[jsonIdx + 1] || "metrics.json";
  writeFileSync(out, JSON.stringify(metrics, null, 2));
  console.log(`JSON écrit : ${out}`);
}
