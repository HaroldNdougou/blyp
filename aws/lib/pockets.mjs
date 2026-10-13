/**
 * Poches — sous-soldes perso. L’argent rangé quitte BALANCE (= disponible) :
 * Pay / Message Money ne peuvent jamais dépenser une poche par erreur.
 * Chaque mouvement = TransactWrite (BALANCE + POCKET + PTX + TX ledger) + idempotence.
 */
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { makeTxReference } from "./txReference.mjs";
import { getUserBalance, userPk } from "./user.mjs";
import { isValidTxAmount } from "./wallet.mjs";

const doc = getDocClient();

export const SAVINGS_POCKET_ID = "savings";
const SAVINGS_LEDGER_NAME = "Épargne personnelle";
const POCKET_NAME_MAX = 40;
const MAX_POCKETS = 20;

function pocketSk(pocketId) {
  return `POCKET#${pocketId}`;
}

function ptxSk(pocketId, ms, txId) {
  return `PTX#${pocketId}#${String(ms).padStart(13, "0")}#${txId}`;
}

function txSk(ms, txId) {
  return `TX#${String(ms).padStart(13, "0")}#${txId}`;
}

function idemSk(key) {
  return `IDEM#pocket#${key}`;
}

export function sanitizePocketName(raw) {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, POCKET_NAME_MAX);
  return s || null;
}

function isValidPocketId(id) {
  return /^[a-z0-9-]{1,40}$/i.test(String(id ?? ""));
}

function pocketPublic(it) {
  return {
    id: String(it.pocketId),
    name: String(it.name ?? ""),
    kind: it.kind === "savings" ? "savings" : "custom",
    balanceFcfa: Number(it.balanceFcfa ?? 0),
    createdAt: it.createdAt ?? null,
    updatedAt: it.updatedAt ?? null,
  };
}

function ptxPublic(it) {
  return {
    id: String(it.txId),
    pocketId: String(it.pocketId),
    direction: it.direction === "out" ? "out" : "in",
    amountFcfa: Number(it.amountFcfa ?? 0),
    createdAt: it.createdAt,
  };
}

function ledgerName(pocket) {
  const name =
    pocket?.kind === "savings" || pocket?.pocketId === SAVINGS_POCKET_ID
      ? SAVINGS_LEDGER_NAME
      : String(pocket?.name ?? "").trim() || "Poche";
  return `Poche · ${name}`;
}

async function getPocketItem(userId, pocketId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: pocketSk(pocketId) },
    }),
  );
  return res.Item ?? null;
}

export async function listPockets(userId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": userPk(userId), ":p": "POCKET#" },
    }),
  );
  return (res.Items ?? [])
    .map(pocketPublic)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function listPocketTransactions(userId, pocketId, limit = 100) {
  if (!isValidPocketId(pocketId)) return [];
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":p": `PTX#${pocketId}#`,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []).map(ptxPublic);
}

/** Items TransactWrite d’un mouvement (BALANCE ↔ POCKET + journaux). */
function moveItems(userId, pocket, pocketId, direction, amount, now, nowMs) {
  const pk = userPk(userId);
  const ptxId = randomUUID();
  const txId = randomUUID();
  const isSavings = pocketId === SAVINGS_POCKET_ID;
  const items = [];

  items.push({
    Update: {
      TableName: getTableName(),
      Key: { PK: pk, SK: "BALANCE" },
      UpdateExpression:
        direction === "in"
          ? "SET balanceFcfa = balanceFcfa - :amt, updatedAt = :now"
          : "SET balanceFcfa = if_not_exists(balanceFcfa, :z) + :amt, updatedAt = :now",
      ConditionExpression:
        direction === "in" ? "balanceFcfa >= :amt" : "attribute_exists(PK)",
      ExpressionAttributeValues:
        direction === "in"
          ? { ":amt": amount, ":now": now }
          : { ":amt": amount, ":now": now, ":z": 0 },
    },
  });

  if (direction === "in") {
    items.push({
      Update: {
        TableName: getTableName(),
        Key: { PK: pk, SK: pocketSk(pocketId) },
        UpdateExpression: isSavings
          ? "SET balanceFcfa = if_not_exists(balanceFcfa, :z) + :amt, updatedAt = :now, pocketId = :pid, #kd = :savings, #nm = if_not_exists(#nm, :sname), createdAt = if_not_exists(createdAt, :now)"
          : "SET balanceFcfa = if_not_exists(balanceFcfa, :z) + :amt, updatedAt = :now",
        ...(isSavings ? {} : { ConditionExpression: "attribute_exists(PK)" }),
        ...(isSavings
          ? { ExpressionAttributeNames: { "#nm": "name", "#kd": "kind" } }
          : {}),
        ExpressionAttributeValues: isSavings
          ? {
              ":amt": amount,
              ":now": now,
              ":z": 0,
              ":pid": SAVINGS_POCKET_ID,
              ":savings": "savings",
              ":sname": SAVINGS_LEDGER_NAME,
            }
          : { ":amt": amount, ":now": now, ":z": 0 },
      },
    });
  } else {
    items.push({
      Update: {
        TableName: getTableName(),
        Key: { PK: pk, SK: pocketSk(pocketId) },
        UpdateExpression: "SET balanceFcfa = balanceFcfa - :amt, updatedAt = :now",
        ConditionExpression: "attribute_exists(PK) AND balanceFcfa >= :amt",
        ExpressionAttributeValues: { ":amt": amount, ":now": now },
      },
    });
  }

  items.push({
    Put: {
      TableName: getTableName(),
      Item: {
        PK: pk,
        SK: ptxSk(pocketId, nowMs, ptxId),
        txId: ptxId,
        pocketId,
        direction,
        amountFcfa: amount,
        createdAt: now,
      },
    },
  });

  items.push({
    Put: {
      TableName: getTableName(),
      Item: {
        PK: pk,
        SK: txSk(nowMs, txId),
        transactionId: txId,
        reference: makeTxReference("PAYMENT"),
        userId,
        type: direction === "in" ? "POCKET_IN" : "POCKET_OUT",
        amountFcfa: amount,
        counterpartyName: ledgerName(pocket ?? { pocketId }),
        counterpartyPhone: null,
        pocketId,
        createdAt: now,
      },
    },
  });

  return { items, ptx: { txId: ptxId, pocketId, direction, amountFcfa: amount, createdAt: now } };
}

async function readIdem(userId, key) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: idemSk(key) },
    }),
  );
  return res.Item?.result ?? null;
}

async function writeIdemResult(userId, key, result) {
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userPk(userId),
        SK: idemSk(key),
        result,
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

function idemPutItem(userId, key, now) {
  return {
    Put: {
      TableName: getTableName(),
      Item: { PK: userPk(userId), SK: idemSk(key), pending: true, createdAt: now },
      ConditionExpression: "attribute_not_exists(PK)",
    },
  };
}

/** Raison d’échec à partir de l’index de l’item annulé. */
function cancelReason(err, offset) {
  const reasons = err?.CancellationReasons ?? [];
  const idx = reasons.findIndex(
    (r) => r?.Code && r.Code !== "None",
  );
  if (idx < 0) return "CONFLICT";
  const rel = idx - offset;
  if (rel < 0) return "IDEMPOTENT_RACE";
  if (rel === 0) return "INSUFFICIENT_BALANCE";
  if (rel === 1) return "POCKET_UNAVAILABLE";
  return "CONFLICT";
}

/**
 * @param {string} userId
 * @param {string} rawName
 * @param {number} initialAmount 0 = poche vide
 * @param {string | null} idempotencyKey
 */
export async function createPocket(userId, rawName, initialAmount, idempotencyKey) {
  const name = sanitizePocketName(rawName);
  if (!name) return { error: "NAME_INVALID" };
  const amount = Math.floor(Number(initialAmount) || 0);
  if (amount < 0 || (amount > 0 && !isValidTxAmount(amount))) {
    return { error: "AMOUNT_INVALID" };
  }

  if (idempotencyKey) {
    const cached = await readIdem(userId, idempotencyKey);
    if (cached) return cached;
  }

  const existing = await listPockets(userId);
  if (existing.filter((p) => p.kind !== "savings").length >= MAX_POCKETS) {
    return { error: "TOO_MANY" };
  }

  const pocketId = randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const pocketItem = {
    PK: userPk(userId),
    SK: pocketSk(pocketId),
    pocketId,
    name,
    kind: "custom",
    balanceFcfa: 0,
    createdAt: now,
    updatedAt: now,
  };

  const items = [];
  if (idempotencyKey) items.push(idemPutItem(userId, idempotencyKey, now));
  const offset = items.length;
  let ptx = null;
  if (amount > 0) {
    pocketItem.balanceFcfa = amount;
    const pk = userPk(userId);
    items.push({
      Update: {
        TableName: getTableName(),
        Key: { PK: pk, SK: "BALANCE" },
        UpdateExpression: "SET balanceFcfa = balanceFcfa - :amt, updatedAt = :now",
        ConditionExpression: "balanceFcfa >= :amt",
        ExpressionAttributeValues: { ":amt": amount, ":now": now },
      },
    });
    items.push({
      Put: {
        TableName: getTableName(),
        Item: pocketItem,
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
    const moved = moveItems(userId, pocketItem, pocketId, "in", amount, now, nowMs);
    /** On garde seulement les journaux (PTX + TX) — BALANCE/POCKET déjà posés ci-dessus. */
    items.push(moved.items[2], moved.items[3]);
    ptx = moved.ptx;
  } else {
    items.push({
      Put: {
        TableName: getTableName(),
        Item: pocketItem,
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  }

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      if (idempotencyKey) {
        const cached = await readIdem(userId, idempotencyKey);
        if (cached) return cached;
      }
      const why = cancelReason(err, offset);
      if (why === "INSUFFICIENT_BALANCE" && amount > 0) {
        return { error: "INSUFFICIENT_BALANCE" };
      }
      return { error: "CONFLICT" };
    }
    throw err;
  }

  const balanceFcfa = await getUserBalance(userId);
  const result = {
    pocket: pocketPublic(pocketItem),
    balanceFcfa,
    transaction: ptx ? ptxPublic(ptx) : null,
  };
  if (idempotencyKey) await writeIdemResult(userId, idempotencyKey, result);
  return result;
}

/**
 * @param {"in" | "out"} direction in = disponible → poche ; out = poche → disponible
 */
export async function movePocketFunds(userId, pocketId, direction, rawAmount, idempotencyKey) {
  if (!isValidPocketId(pocketId)) return { error: "POCKET_NOT_FOUND" };
  if (direction !== "in" && direction !== "out") return { error: "DIRECTION_INVALID" };
  const amount = Math.floor(Number(rawAmount) || 0);
  if (!isValidTxAmount(amount)) return { error: "AMOUNT_INVALID" };

  if (idempotencyKey) {
    const cached = await readIdem(userId, idempotencyKey);
    if (cached) return cached;
  }

  const pocket = await getPocketItem(userId, pocketId);
  if (!pocket && pocketId !== SAVINGS_POCKET_ID) return { error: "POCKET_NOT_FOUND" };
  if (!pocket && direction === "out") return { error: "POCKET_INSUFFICIENT" };

  const now = new Date().toISOString();
  const nowMs = Date.now();
  const items = [];
  if (idempotencyKey) items.push(idemPutItem(userId, idempotencyKey, now));
  const offset = items.length;
  const moved = moveItems(userId, pocket, pocketId, direction, amount, now, nowMs);
  items.push(...moved.items);

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      if (idempotencyKey) {
        const cached = await readIdem(userId, idempotencyKey);
        if (cached) return cached;
      }
      const why = cancelReason(err, offset);
      if (why === "INSUFFICIENT_BALANCE") return { error: "INSUFFICIENT_BALANCE" };
      if (why === "POCKET_UNAVAILABLE") {
        return { error: direction === "out" ? "POCKET_INSUFFICIENT" : "POCKET_NOT_FOUND" };
      }
      return { error: "CONFLICT" };
    }
    throw err;
  }

  const [balanceFcfa, after] = await Promise.all([
    getUserBalance(userId),
    getPocketItem(userId, pocketId),
  ]);
  const result = {
    pocket: after ? pocketPublic(after) : null,
    balanceFcfa,
    transaction: ptxPublic(moved.ptx),
  };
  if (idempotencyKey) await writeIdemResult(userId, idempotencyKey, result);
  return result;
}

export async function renamePocket(userId, pocketId, rawName) {
  if (!isValidPocketId(pocketId) || pocketId === SAVINGS_POCKET_ID) {
    return { error: "POCKET_NOT_FOUND" };
  }
  const name = sanitizePocketName(rawName);
  if (!name) return { error: "NAME_INVALID" };
  const now = new Date().toISOString();
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: getTableName(),
              Key: { PK: userPk(userId), SK: pocketSk(pocketId) },
              UpdateExpression: "SET #nm = :n, updatedAt = :now",
              ConditionExpression: "attribute_exists(PK)",
              ExpressionAttributeNames: { "#nm": "name" },
              ExpressionAttributeValues: { ":n": name, ":now": now },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      return { error: "POCKET_NOT_FOUND" };
    }
    throw err;
  }
  const after = await getPocketItem(userId, pocketId);
  return { pocket: after ? pocketPublic(after) : null };
}

/** Supprime la poche ; son solde revient au disponible dans la même transaction. */
export async function deletePocket(userId, pocketId) {
  if (!isValidPocketId(pocketId) || pocketId === SAVINGS_POCKET_ID) {
    return { error: "POCKET_NOT_FOUND" };
  }
  const pocket = await getPocketItem(userId, pocketId);
  if (!pocket) return { error: "POCKET_NOT_FOUND" };
  const bal = Number(pocket.balanceFcfa ?? 0);
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const pk = userPk(userId);
  const items = [
    {
      Delete: {
        TableName: getTableName(),
        Key: { PK: pk, SK: pocketSk(pocketId) },
        ConditionExpression: "balanceFcfa = :b",
        ExpressionAttributeValues: { ":b": bal },
      },
    },
  ];
  if (bal > 0) {
    const moved = moveItems(userId, pocket, pocketId, "out", bal, now, nowMs);
    items.push(moved.items[0], moved.items[3]);
  }
  try {
    await doc.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (err) {
    if (err?.name === "TransactionCanceledException") return { error: "CONFLICT" };
    throw err;
  }
  return { ok: true, balanceFcfa: await getUserBalance(userId) };
}
