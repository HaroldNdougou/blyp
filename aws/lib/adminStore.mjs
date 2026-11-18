import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ACTIVITY_EVENT_TYPES } from "./adminEvents.mjs";
import {
  dayKey,
  dayRange,
  daysBetween,
  monthKey,
  pad13,
  shiftDay,
  weekKey,
} from "./adminTime.mjs";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";

const doc = getDocClient();

/** Types qui ont un compteur + un volume FCFA. */
const MONEY_TYPES = ["payment", "transfer", "deposit", "withdrawal"];
const COUNT_TYPES = [
  "signup",
  "login",
  "app_open",
  "message",
  ...MONEY_TYPES,
];

/** `app_open` est très volumineux : on garde les compteurs, l'événement brut expire. */
const APP_OPEN_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const SET_TTL_MS = 70 * 24 * 60 * 60 * 1000;
const APP_OPEN_DEDUPE_MS = 45_000;

const T = () => getTableName();

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

async function claimOnce(pk, sk, ttlMs = null) {
  try {
    await doc.send(
      new PutCommand({
        TableName: T(),
        Item: {
          PK: pk,
          SK: sk,
          createdAt: new Date().toISOString(),
          ...(ttlMs ? { expiresAt: ttlFromNowMs(ttlMs) } : {}),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/** ADD atomique de plusieurs compteurs sur un même item. */
export async function addCounters(pk, counters, sk = "ALL") {
  const entries = Object.entries(counters).filter(
    ([, v]) => Number.isFinite(v) && v !== 0,
  );
  if (!entries.length) return;
  const names = {};
  const values = { ":now": new Date().toISOString() };
  const adds = entries.map(([k, v], i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = v;
    return `#k${i} :v${i}`;
  });
  await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: pk, SK: sk },
      UpdateExpression: `ADD ${adds.join(", ")} SET updatedAt = :now`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

function statPk(kind, key) {
  return `ASTAT#${kind}#${key}`;
}

/* -------------------------------------------------------------------------- */
/* Écriture d'un événement                                                     */
/* -------------------------------------------------------------------------- */

function fullName(profile) {
  const fn = String(profile?.firstName ?? "").trim();
  const ln = String(profile?.lastName ?? "").trim();
  return `${fn} ${ln}`.trim() || null;
}

function isRegistered(profile) {
  return Boolean(
    String(profile?.firstName ?? "").trim() && profile?.transactionPinHash,
  );
}

/**
 * Enregistre l'événement (idempotent) puis met à jour tous les compteurs.
 * @returns {Promise<{ stored: boolean, item?: Record<string, unknown> }>}
 */
export async function ingestEvent(evt, profile) {
  const ms = Date.parse(evt.at) || Date.now();
  const day = dayKey(ms);
  const type = evt.type;

  const item = {
    PK: `AEVT#${day}`,
    SK: `${pad13(ms)}#${evt.id}`,
    id: evt.id,
    type,
    at: new Date(ms).toISOString(),
    userId: evt.userId ?? null,
    phone: profile?.phone ?? evt.data?.phone ?? null,
    name: fullName(profile) ?? evt.data?.name ?? null,
    data: evt.data ?? {},
    ...(type === "app_open"
      ? { expiresAt: ttlFromNowMs(APP_OPEN_TTL_MS) }
      : {}),
  };

  /** `app_open` : au plus un enregistrement / 45 s / utilisateur (l'appli rappelle /me souvent). */
  if (type === "app_open" && evt.userId) {
    const bucket = Math.floor(ms / APP_OPEN_DEDUPE_MS);
    const first = await claimOnce(
      `ASET#OPEN#${evt.userId}`,
      `B#${bucket}`,
      5 * 60 * 1000,
    );
    if (!first) return { stored: false };
  }

  try {
    await doc.send(
      new PutCommand({
        TableName: T(),
        Item: { ...item, statsDone: false },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (err) {
    if (err?.name !== "ConditionalCheckFailedException") throw err;
    /** Doublon SQS : on ne rejoue les compteurs que si la livraison précédente a échoué en route. */
    const existing = await doc.send(
      new GetCommand({ TableName: T(), Key: { PK: item.PK, SK: item.SK } }),
    );
    if (existing.Item?.statsDone !== false) return { stored: false };
    await bumpStats(item, profile, ms, day);
    await markStatsDone(item);
    return { stored: true, item };
  }

  await bumpStats(item, profile, ms, day);
  await markStatsDone(item);
  return { stored: true, item };
}

async function markStatsDone(item) {
  await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: "SET statsDone = :t",
      ExpressionAttributeValues: { ":t": true },
    }),
  );
}

async function bumpStats(item, profile, ms, day) {
  const type = item.type;
  /**
   * Clé métier unique : une inscription / une transaction n'est comptée qu'une fois,
   * même si elle arrive deux fois (événement en direct + reconstitution de l'historique).
   */
  const bizKey =
    type === "signup" && item.userId
      ? `SIGNUP#${item.userId}`
      : MONEY_TYPES.includes(type) && item.data?.transactionId
        ? `TX#${item.data.transactionId}`
        : null;
  if (bizKey && !(await claimOnce("ASET#BIZ", bizKey))) return;
  const counters = {};
  if (COUNT_TYPES.includes(type)) counters[`n_${type}`] = 1;
  if (MONEY_TYPES.includes(type)) {
    const amount = Math.floor(Number(item.data?.amountFcfa) || 0);
    if (amount > 0) counters[`v_${type}`] = amount;
  }

  const totalCounters = { ...counters };
  const dayCounters = { ...counters };

  if (type === "signup") {
    totalCounters.users = 1;
    const created = Date.parse(profile?.createdAt ?? "");
    const cohortDay = Number.isFinite(created) ? dayKey(created) : day;
    await addCounters(statPk("C", cohortDay), { size: 1 });
  }
  if (type === "admin_action") {
    const delta = Math.trunc(Number(item.data?.ledgerDeltaFcfa) || 0);
    if (delta > 0) totalCounters.v_admin_credit = delta;
    if (delta < 0) totalCounters.v_admin_debit = -delta;
    if (delta > 0) dayCounters.v_admin_credit = delta;
    if (delta < 0) dayCounters.v_admin_debit = -delta;
  }
  if (type === "user_deleted") {
    totalCounters.deletedUsers = 1;
    dayCounters.n_user_deleted = 1;
    const forfeited = Math.trunc(Number(item.data?.balanceFcfa) || 0);
    if (forfeited > 0) {
      totalCounters.v_admin_debit = (totalCounters.v_admin_debit ?? 0) + forfeited;
      dayCounters.v_admin_debit = (dayCounters.v_admin_debit ?? 0) + forfeited;
    }
  }

  /* Activité unique : jour / semaine / mois + rétention par cohorte. */
  if (
    item.userId &&
    ACTIVITY_EVENT_TYPES.has(type) &&
    (type === "signup" || isRegistered(profile))
  ) {
    const uid = String(item.userId);
    if (await claimOnce(`ASET#D#${day}`, `U#${uid}`, SET_TTL_MS)) {
      dayCounters.activeUsers = 1;
      const created = Date.parse(profile?.createdAt ?? "");
      if (Number.isFinite(created)) {
        const age = daysBetween(dayKey(created), day);
        if (age === 1 || age === 7 || age === 30) {
          await addCounters(statPk("C", dayKey(created)), { [`d${age}`]: 1 });
        }
      }
    }
    const wk = weekKey(ms);
    if (await claimOnce(`ASET#W#${wk}`, `U#${uid}`, SET_TTL_MS)) {
      await addCounters(statPk("W", wk), { activeUsers: 1 });
    }
    const mo = monthKey(ms);
    if (await claimOnce(`ASET#M#${mo}`, `U#${uid}`, SET_TTL_MS * 2)) {
      await addCounters(statPk("M", mo), { activeUsers: 1 });
    }
  }

  /* Activation : premier paiement de l'utilisateur. */
  if (type === "payment" && item.userId) {
    if (await claimOnce("ASET#PAYER", `U#${item.userId}`)) {
      dayCounters.activatedUsers = 1;
      totalCounters.activatedUsers = 1;
    }
    const commerceId = String(item.data?.commerceId ?? "").trim();
    if (commerceId) {
      if (await claimOnce(`ASET#MD#${day}`, `C#${commerceId}`, SET_TTL_MS)) {
        dayCounters.activeMerchants = 1;
      }
      if (await claimOnce("ASET#MERCH", `C#${commerceId}`)) {
        totalCounters.payingMerchants = 1;
      }
    }
  }

  await addCounters(statPk("D", day), dayCounters);
  await addCounters("ASTAT#TOTAL", totalCounters);
}

/* -------------------------------------------------------------------------- */
/* Lecture du fil d'événements                                                 */
/* -------------------------------------------------------------------------- */

function cursorMs(cursor) {
  const n = Number.parseInt(String(cursor).slice(0, 13), 10);
  return Number.isFinite(n) ? n : 0;
}

async function queryDay(day, { after = null, limit = 200, desc = false } = {}) {
  const out = [];
  let lastKey;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: after
          ? "PK = :pk AND SK > :after"
          : "PK = :pk",
        ExpressionAttributeValues: after
          ? { ":pk": `AEVT#${day}`, ":after": after }
          : { ":pk": `AEVT#${day}` },
        ScanIndexForward: !desc,
        Limit: Math.max(1, limit - out.length),
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );
    out.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey && out.length < limit);
  return out;
}

/** Forme publique d'un événement (sans clés internes). */
export function publicEvent(it) {
  return {
    id: it.id,
    key: it.SK,
    type: it.type,
    at: it.at,
    userId: it.userId ?? null,
    phone: it.phone ?? null,
    name: it.name ?? null,
    data: it.data ?? {},
  };
}

/**
 * Sans `since` : les `limit` derniers événements (récents d'abord).
 * Avec `since` (clé SK) : les nouveaux, du plus ancien au plus récent.
 */
export async function listEvents({ since = null, limit = 100, now = Date.now() } = {}) {
  const today = dayKey(now);
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (!since) {
    const out = [];
    let day = today;
    for (let i = 0; i < 14 && out.length < cap; i++) {
      out.push(...(await queryDay(day, { limit: cap - out.length, desc: true })));
      day = shiftDay(day, -1);
    }
    return {
      items: out.map(publicEvent),
      cursor: out[0]?.SK ?? null,
    };
  }
  const startDay = dayKey(cursorMs(since) || now);
  const out = [];
  for (const day of dayRange(startDay, today)) {
    out.push(...(await queryDay(day, { after: since, limit: cap - out.length })));
    if (out.length >= cap) break;
  }
  return {
    items: out.map(publicEvent),
    cursor: out.length ? out[out.length - 1].SK : since,
  };
}

/** Tous les événements d'une période (export). */
export async function eventsForRange(from, to, { types = null, hardLimit = 50_000 } = {}) {
  const out = [];
  for (const day of dayRange(from, to)) {
    let after = null;
    for (;;) {
      const batch = await queryDay(day, { after, limit: 1000 });
      if (!batch.length) break;
      for (const it of batch) {
        if (!types || types.includes(it.type)) out.push(publicEvent(it));
      }
      after = batch[batch.length - 1].SK;
      if (batch.length < 1000 || out.length >= hardLimit) break;
    }
    if (out.length >= hardLimit) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Statistiques                                                                */
/* -------------------------------------------------------------------------- */

async function batchGetStats(keys) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await doc.send(
      new BatchGetCommand({
        RequestItems: {
          [T()]: { Keys: chunk.map((pk) => ({ PK: pk, SK: "ALL" })) },
        },
      }),
    );
    for (const it of res.Responses?.[T()] ?? []) out.set(it.PK, it);
  }
  return out;
}

const NUMERIC_SKIP = new Set(["PK", "SK", "updatedAt"]);

function cleanStat(it) {
  const out = {};
  if (!it) return out;
  for (const [k, v] of Object.entries(it)) {
    if (NUMERIC_SKIP.has(k)) continue;
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

/** @returns {Promise<Array<{ day: string } & Record<string, number>>>} */
export async function dailyStats(from, to) {
  const days = dayRange(from, to);
  const map = await batchGetStats(days.map((d) => statPk("D", d)));
  return days.map((day) => ({ day, ...cleanStat(map.get(statPk("D", day))) }));
}

export async function totals() {
  const res = await doc.send(
    new GetCommand({ TableName: T(), Key: { PK: "ASTAT#TOTAL", SK: "ALL" } }),
  );
  return cleanStat(res.Item);
}

export async function periodActiveUsers(kind, key) {
  const res = await doc.send(
    new GetCommand({
      TableName: T(),
      Key: { PK: statPk(kind === "week" ? "W" : "M", key), SK: "ALL" },
    }),
  );
  return Number(res.Item?.activeUsers ?? 0);
}

export async function cohorts(fromDay, toDay) {
  const days = dayRange(fromDay, toDay);
  const map = await batchGetStats(days.map((d) => statPk("C", d)));
  return days.map((day) => {
    const s = cleanStat(map.get(statPk("C", day)));
    return {
      day,
      size: s.size ?? 0,
      d1: s.d1 ?? 0,
      d7: s.d7 ?? 0,
      d30: s.d30 ?? 0,
    };
  });
}

/** Somme de lignes journalières. */
export function sumDays(rows) {
  const out = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k === "day" || typeof v !== "number") continue;
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Réglages & journal d'audit                                                  */
/* -------------------------------------------------------------------------- */

export const DEFAULT_NOTIFY = Object.freeze({
  signup: { push: true, email: true },
  login: { push: true, email: true },
  app_open: { push: true, email: true },
  message: { push: true, email: true },
  payment: { push: true, email: true },
  transfer: { push: true, email: true },
  deposit: { push: true, email: true },
  withdrawal: { push: true, email: true },
  user_deleted: { push: true, email: true },
  admin_action: { push: true, email: true },
});

export async function getSettings() {
  const res = await doc.send(
    new GetCommand({ TableName: T(), Key: { PK: "ADMIN#SETTINGS", SK: "CONFIG" } }),
  );
  const saved = res.Item?.notify ?? {};
  const notify = {};
  for (const [type, def] of Object.entries(DEFAULT_NOTIFY)) {
    notify[type] = {
      push: saved[type]?.push ?? def.push,
      email: saved[type]?.email ?? def.email,
    };
  }
  return {
    notify,
    emailPerMinuteCap: Number(res.Item?.emailPerMinuteCap ?? 20),
  };
}

export async function saveSettings(input) {
  const current = await getSettings();
  const notify = { ...current.notify };
  for (const type of Object.keys(DEFAULT_NOTIFY)) {
    const v = input?.notify?.[type];
    if (!v) continue;
    notify[type] = {
      push: v.push === true,
      email: v.email === true,
    };
  }
  const cap = Math.min(
    Math.max(Math.floor(Number(input?.emailPerMinuteCap ?? current.emailPerMinuteCap)), 1),
    200,
  );
  await doc.send(
    new PutCommand({
      TableName: T(),
      Item: {
        PK: "ADMIN#SETTINGS",
        SK: "CONFIG",
        notify,
        emailPerMinuteCap: cap,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  return { notify, emailPerMinuteCap: cap };
}

/** Plafond d'emails / minute (anti-avalanche). Retourne true si on peut envoyer. */
export async function takeEmailSlot(cap) {
  const minute = Math.floor(Date.now() / 60_000);
  const res = await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: `ARATE#email#${minute}`, SK: "ALL" },
      UpdateExpression: "ADD n :one SET expiresAt = :ttl",
      ExpressionAttributeValues: {
        ":one": 1,
        ":ttl": ttlFromNowMs(10 * 60_000),
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(res.Attributes?.n ?? 1) <= cap;
}

/**
 * Journal d'audit — jamais supprimé. Chaque action admin y est inscrite
 * AVANT/APRÈS exécution (qui, quoi, sur qui, résultat).
 */
export async function writeAudit(entry) {
  const ms = Date.now();
  const id = randomUUID();
  const item = {
    PK: `AAUDIT#${dayKey(ms)}`,
    SK: `${pad13(ms)}#${id}`,
    id,
    at: new Date(ms).toISOString(),
    admin: String(entry.admin ?? ""),
    action: String(entry.action ?? ""),
    target: entry.target ?? null,
    params: entry.params ?? {},
    result: entry.result ?? null,
    ip: entry.ip ?? null,
  };
  await doc.send(new PutCommand({ TableName: T(), Item: item }));
  return item;
}

export async function listAudit(days = 7) {
  const today = dayKey(Date.now());
  const out = [];
  for (const day of dayRange(shiftDay(today, -(days - 1)), today).reverse()) {
    const res = await doc.send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `AAUDIT#${day}` },
        ScanIndexForward: false,
        Limit: 200,
      }),
    );
    for (const it of res.Items ?? []) {
      out.push({
        id: it.id,
        at: it.at,
        admin: it.admin,
        action: it.action,
        target: it.target,
        params: it.params,
        result: it.result,
        ip: it.ip,
      });
    }
  }
  return out;
}
