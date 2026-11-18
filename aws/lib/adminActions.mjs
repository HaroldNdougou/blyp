import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { emitAdminEvent } from "./adminEvents.mjs";
import { accountPk, resolveAccountId } from "./accountId.mjs";
import { listCommercesForUser } from "./commerce.mjs";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { normalizeCameroonPhone } from "./phone.mjs";
import { makeTxReference, resolveTxReference } from "./txReference.mjs";
import {
  findOrCreateUserByPhone,
  getUserBalance,
  getUserIdByPhone,
  getUserProfile,
  updateProfileNames,
  userPk,
} from "./user.mjs";

/**
 * Actions « souveraines » du fondateur. Chaque fonction :
 *  - valide strictement ses entrées ;
 *  - est idempotente quand c'est un mouvement d'argent ;
 *  - retourne `{ error }` (jamais d'exception pour un cas métier) ;
 *  - NE PAS appeler sans avoir vérifié l'élévation (fait dans le handler).
 */

const doc = getDocClient();
const T = () => getTableName();

export const ADMIN_MAX_ADJUST_FCFA = 10_000_000;

const SAFE_PROFILE_FIELDS = [
  "userId",
  "accountId",
  "phone",
  "firstName",
  "lastName",
  "createdAt",
  "updatedAt",
  "isMerchant",
  "kycStatus",
  "kycLevel",
  "payBlocked",
  "createdByAdmin",
  "avatarUpdatedAt",
  "activeContextType",
];

function publicProfile(p) {
  const out = {};
  for (const k of SAFE_PROFILE_FIELDS) if (p?.[k] !== undefined) out[k] = p[k];
  out.hasPin = Boolean(p?.transactionPinHash);
  out.accountId = p ? resolveAccountId(p) : null;
  return out;
}

function nameOf(p) {
  return `${String(p?.firstName ?? "").trim()} ${String(p?.lastName ?? "").trim()}`.trim();
}

/* -------------------------------------------------------------------------- */
/* Lecture                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Liste des utilisateurs (scan borné — à remplacer par un index dédié au-delà de ~10 000 comptes).
 * `query` : numéro, ID de compte ou fragment de nom (insensible à la casse).
 */
export async function listUsers({ query = "", limit = 100, maxPages = 40 } = {}) {
  const q = String(query ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const items = [];
  let key;
  let pages = 0;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: T(),
        FilterExpression: "SK = :p AND begins_with(PK, :u)",
        ExpressionAttributeValues: { ":p": "PROFILE", ":u": "USER#" },
        ProjectionExpression: SAFE_PROFILE_FIELDS.join(", "),
        ...(key ? { ExclusiveStartKey: key } : {}),
      }),
    );
    items.push(...(res.Items ?? []));
    key = res.LastEvaluatedKey;
    pages += 1;
  } while (key && pages < maxPages);

  let rows = items;
  if (q) {
    rows = items.filter((p) => {
      const hay = `${nameOf(p)} ${p.accountId ?? ""} ${p.userId ?? ""}`.toLowerCase();
      const phone = String(p.phone ?? "").replace(/\D/g, "");
      return (
        hay.includes(q) || (qDigits.length >= 3 && phone.includes(qDigits))
      );
    });
  }
  rows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const total = rows.length;
  const page = rows.slice(0, Math.min(Math.max(limit, 1), 500));
  const withBalance = await Promise.all(
    page.map(async (p) => ({
      ...publicProfile(p),
      balanceFcfa: await getUserBalance(p.userId),
    })),
  );
  return { total, truncated: Boolean(key), users: withBalance };
}

export async function getUserDetail(userId) {
  const profile = await getUserProfile(userId);
  if (!profile) return null;
  const [balanceFcfa, commerces, txRes] = await Promise.all([
    getUserBalance(userId),
    listCommercesForUser(userId).catch(() => []),
    doc.send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :tx)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":tx": "TX#" },
        ScanIndexForward: false,
        Limit: 50,
      }),
    ),
  ]);
  return {
    profile: publicProfile(profile),
    balanceFcfa,
    commerces,
    transactions: (txRes.Items ?? []).map((t) => ({
      id: t.transactionId,
      reference: resolveTxReference(t),
      type: t.type ?? null,
      amountFcfa: t.amountFcfa,
      counterpartyName: t.counterpartyName ?? null,
      counterpartyPhone: t.counterpartyPhone ?? null,
      createdAt: t.createdAt,
    })),
  };
}

/** Résout `userId` | numéro | accountId vers un userId. */
export async function resolveUserId(ref) {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  if (/^[0-9a-f-]{36}$/i.test(raw)) {
    return (await getUserProfile(raw)) ? raw : null;
  }
  if (/^BLYP-U-/i.test(raw)) {
    const res = await doc.send(
      new GetCommand({
        TableName: T(),
        Key: { PK: accountPk(raw.toUpperCase()), SK: "META" },
      }),
    );
    return res.Item?.userId ?? null;
  }
  const phone = normalizeCameroonPhone(raw);
  return phone ? getUserIdByPhone(phone) : null;
}

/* -------------------------------------------------------------------------- */
/* Écriture                                                                    */
/* -------------------------------------------------------------------------- */

function validAmount(n) {
  return Number.isInteger(n) && n >= 1 && n <= ADMIN_MAX_ADJUST_FCFA;
}

/**
 * Crédit / débit souverain d'un solde personnel.
 * Atomique (solde + ligne d'historique + clé d'idempotence dans une seule transaction).
 * @param {{ userId: string, direction: "credit"|"debit", amountFcfa: number, reason: string, idempotencyKey: string, admin: string, ip?: string|null }} p
 */
export async function adjustBalance(p) {
  const amount = Math.floor(Number(p.amountFcfa));
  const reason = String(p.reason ?? "").trim().slice(0, 200);
  const key = String(p.idempotencyKey ?? "").trim();
  if (!validAmount(amount)) return { error: "AMOUNT_INVALID" };
  if (p.direction !== "credit" && p.direction !== "debit") {
    return { error: "DIRECTION_INVALID" };
  }
  if (reason.length < 3) return { error: "REASON_REQUIRED" };
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return { error: "IDEMPOTENCY_REQUIRED" };

  const profile = await getUserProfile(p.userId);
  if (!profile) return { error: "USER_NOT_FOUND" };

  const idemPk = `AIDEM#${key}`;
  const prior = await doc.send(
    new GetCommand({ TableName: T(), Key: { PK: idemPk, SK: "ALL" } }),
  );
  if (prior.Item) {
    return { ok: true, reused: true, ...prior.Item.result };
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const txId = randomUUID();
  const credit = p.direction === "credit";
  const reference = makeTxReference(credit ? "DEPOSIT" : "PAYMENT");
  const balanceBefore = await getUserBalance(p.userId);

  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: T(),
              Item: {
                PK: idemPk,
                SK: "ALL",
                createdAt: now,
                result: {
                  transactionId: txId,
                  reference,
                  direction: p.direction,
                  amountFcfa: amount,
                  balanceBeforeFcfa: balanceBefore,
                  balanceAfterFcfa: balanceBefore + (credit ? amount : -amount),
                },
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Update: {
              TableName: T(),
              Key: { PK: userPk(p.userId), SK: "BALANCE" },
              UpdateExpression: credit
                ? "SET balanceFcfa = if_not_exists(balanceFcfa, :z) + :amt, updatedAt = :now"
                : "SET balanceFcfa = balanceFcfa - :amt, updatedAt = :now",
              ConditionExpression: credit
                ? "attribute_exists(PK)"
                : "balanceFcfa >= :amt",
              ExpressionAttributeValues: credit
                ? { ":amt": amount, ":z": 0, ":now": now }
                : { ":amt": amount, ":now": now },
            },
          },
          {
            Put: {
              TableName: T(),
              Item: {
                PK: userPk(p.userId),
                SK: `TX#${String(nowMs).padStart(13, "0")}#${txId}`,
                transactionId: txId,
                reference,
                userId: p.userId,
                type: credit ? "ADMIN_CREDIT" : "ADMIN_DEBIT",
                amountFcfa: amount,
                counterpartyName: "Ajustement Blyp",
                counterpartyPhone: null,
                adminReason: reason,
                createdAt: now,
              },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      const raced = await doc.send(
        new GetCommand({ TableName: T(), Key: { PK: idemPk, SK: "ALL" } }),
      );
      if (raced.Item) return { ok: true, reused: true, ...raced.Item.result };
      return { error: credit ? "USER_NOT_FOUND" : "INSUFFICIENT_BALANCE" };
    }
    throw err;
  }

  const balanceAfter = balanceBefore + (credit ? amount : -amount);
  const fresh = await getUserBalance(p.userId);

  /** L'appli du client se met à jour en direct (WS wallet), sans bloquer l'action. */
  try {
    const { postRealtimeToUser } = await import("./realtimeWs.mjs");
    await postRealtimeToUser(p.userId, { type: "wallet_balance", balanceFcfa: fresh });
  } catch (err) {
    console.warn("[adminActions] realtime balance failed", err?.message ?? err);
  }

  await emitAdminEvent({
    type: "admin_action",
    userId: p.userId,
    data: {
      action: credit ? "Crédit de solde" : "Débit de solde",
      targetLabel: nameOf(profile) || profile.phone,
      amountFcfa: amount,
      reason,
      transactionId: txId,
      ledgerDeltaFcfa: credit ? amount : -amount,
      balanceBeforeFcfa: balanceBefore,
      balanceAfterFcfa: fresh,
      ip: p.ip ?? null,
    },
  });

  return {
    ok: true,
    reused: false,
    transactionId: txId,
    reference,
    direction: p.direction,
    amountFcfa: amount,
    balanceBeforeFcfa: balanceBefore,
    balanceAfterFcfa: fresh ?? balanceAfter,
  };
}

/** Création d'un compte par l'admin : le client finalise avec son OTP + son PIN. */
export async function createUser({ phone, firstName, lastName, admin, ip = null }) {
  const normalized = normalizeCameroonPhone(phone);
  if (!normalized) return { error: "PHONE_INVALID" };
  const fn = String(firstName ?? "").trim().slice(0, 80);
  const ln = String(lastName ?? "").trim().slice(0, 80);
  if (!fn || !ln) return { error: "NAME_REQUIRED" };

  const existingId = await getUserIdByPhone(normalized);
  if (existingId) {
    const existing = await getUserProfile(existingId);
    if (existing?.transactionPinHash || String(existing?.firstName ?? "").trim()) {
      return { error: "USER_EXISTS", userId: existingId };
    }
  }
  const { userId, isNewAccount } = await findOrCreateUserByPhone(normalized);
  await updateProfileNames(userId, fn, ln);
  await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
      UpdateExpression: "SET createdByAdmin = :t, updatedAt = :now",
      ExpressionAttributeValues: { ":t": true, ":now": new Date().toISOString() },
    }),
  );
  await emitAdminEvent({
    type: "admin_action",
    userId,
    data: {
      action: "Création de compte",
      targetLabel: `${fn} ${ln}`,
      reason: "Compte créé depuis le tableau de bord (le client termine avec son code SMS et son PIN)",
      ip,
    },
  });
  return { ok: true, userId, isNewAccount, phone: normalized };
}

export async function setPayBlocked({ userId, blocked, reason, admin, ip = null }) {
  const profile = await getUserProfile(userId);
  if (!profile) return { error: "USER_NOT_FOUND" };
  await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
      UpdateExpression: "SET payBlocked = :b, updatedAt = :now",
      ExpressionAttributeValues: { ":b": Boolean(blocked), ":now": new Date().toISOString() },
    }),
  );
  await emitAdminEvent({
    type: "admin_action",
    userId,
    data: {
      action: blocked ? "Blocage des paiements" : "Déblocage des paiements",
      targetLabel: nameOf(profile) || profile.phone,
      reason: String(reason ?? "").slice(0, 200),
      ip,
    },
  });
  return { ok: true, payBlocked: Boolean(blocked) };
}

async function queryAll(pk) {
  const out = [];
  let key;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ...(key ? { ExclusiveStartKey: key } : {}),
      }),
    );
    out.push(...(res.Items ?? []));
    key = res.LastEvaluatedKey;
  } while (key);
  return out;
}

/**
 * Suppression définitive d'un compte.
 * Garde-fous : confirmation par le numéro, refus s'il reste du solde (sauf `forfeitBalance`),
 * refus si le compte possède des commerces. Une archive (profil sans PIN + solde) est conservée.
 */
export async function deleteUser({
  userId,
  confirmPhone,
  forfeitBalance = false,
  reason,
  admin,
  ip = null,
}) {
  const profile = await getUserProfile(userId);
  if (!profile) return { error: "USER_NOT_FOUND" };
  const phone = String(profile.phone ?? "");
  const digits = (s) => String(s ?? "").replace(/\D/g, "").slice(-9);
  if (!digits(confirmPhone) || digits(confirmPhone) !== digits(phone)) {
    return { error: "CONFIRM_PHONE_MISMATCH" };
  }
  const why = String(reason ?? "").trim().slice(0, 200);
  if (why.length < 3) return { error: "REASON_REQUIRED" };

  const commerces = await listCommercesForUser(userId).catch(() => []);
  if (commerces.length) return { error: "HAS_COMMERCES", count: commerces.length };

  const balanceFcfa = await getUserBalance(userId);
  if (balanceFcfa > 0 && !forfeitBalance) {
    return { error: "BALANCE_NOT_ZERO", balanceFcfa };
  }

  const items = await queryAll(userPk(userId));
  const now = new Date().toISOString();

  /** Archive d'abord : on ne perd jamais la trace d'un compte supprimé. */
  await doc.send(
    new PutCommand({
      TableName: T(),
      Item: {
        PK: `ADELETED#${userId}`,
        SK: "ARCHIVE",
        deletedAt: now,
        deletedBy: admin,
        reason: why,
        profile: publicProfile(profile),
        balanceFcfa,
        itemCount: items.length,
        txCount: items.filter((i) => String(i.SK).startsWith("TX#")).length,
      },
    }),
  );

  const toDelete = items.map((i) => ({ PK: i.PK, SK: i.SK }));
  if (phone) toDelete.push({ PK: `PHONE#${phone}`, SK: "META" });
  if (profile.accountId) {
    toDelete.push({ PK: accountPk(profile.accountId), SK: "META" });
  }
  for (let i = 0; i < toDelete.length; i += 25) {
    const chunk = toDelete.slice(i, i + 25);
    let pending = {
      [T()]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
    };
    for (let attempt = 0; attempt < 5 && Object.keys(pending).length; attempt++) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: pending }));
      pending = res.UnprocessedItems ?? {};
      if (Object.keys(pending).length) {
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
  }

  await emitAdminEvent({
    type: "user_deleted",
    userId,
    data: {
      name: nameOf(profile) || null,
      phone,
      balanceFcfa,
      forfeitedBalance: balanceFcfa > 0,
      reason: why,
      ip,
    },
  });
  return { ok: true, deletedItems: toDelete.length, balanceFcfa };
}

