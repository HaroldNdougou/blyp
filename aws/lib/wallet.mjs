import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { getUserBalance, getUserProfile, userPk } from "./user.mjs";

const doc = getDocClient();

/** Plafond transaction FCFA — 6 chiffres (COBAC/BEAC, sans agrément au démarrage). */
export const MAX_TX_AMOUNT_FCFA = 999_999;

export function depositLimits() {
  const min = Math.max(
    1,
    parseInt(String(process.env.DEPOSIT_MIN_FCFA ?? "1"), 10) || 1,
  );
  const envMax =
    parseInt(String(process.env.DEPOSIT_MAX_FCFA ?? String(MAX_TX_AMOUNT_FCFA)), 10) ||
    MAX_TX_AMOUNT_FCFA;
  const max = Math.min(MAX_TX_AMOUNT_FCFA, envMax);
  return { min, max };
}

export function isValidTxAmount(amount) {
  return (
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= MAX_TX_AMOUNT_FCFA &&
    amount === Math.floor(amount)
  );
}

export function isAsyncDepositMode() {
  return (process.env.DEPOSIT_MODE || "sync").toLowerCase() === "async";
}

function txSk(createdAtMs, txId) {
  return `TX#${String(createdAtMs).padStart(13, "0")}#${txId}`;
}

function depositSk(depositIntentId) {
  return `DEPOSIT#${depositIntentId}`;
}

function depositIdemSk(idempotencyKey) {
  return `IDEM#deposit#${idempotencyKey}`;
}

function payIdemSk(idempotencyKey) {
  return `IDEM#pay#${idempotencyKey}`;
}

function pawapayIdemPk(pawapayDepositId) {
  return `IDEM#pawapay#${pawapayDepositId}`;
}

export async function getDepositIntent(userId, depositIntentId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: depositSk(depositIntentId) },
    }),
  );
  return res.Item ?? null;
}

export async function getDepositByIdempotencyKey(userId, idempotencyKey) {
  const marker = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: depositIdemSk(idempotencyKey) },
    }),
  );
  if (!marker?.depositIntentId) return null;
  return getDepositIntent(userId, marker.depositIntentId);
}

export async function getPayIdempotencyResult(userId, idempotencyKey) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: payIdemSk(idempotencyKey) },
    }),
  );
  if (!res.Item?.balanceFcfa && res.Item?.balanceFcfa !== 0) return null;
  return { balanceFcfa: Number(res.Item.balanceFcfa) };
}

export function depositIntentToStatusResponse(intent, balanceFcfa) {
  if (intent.status === "COMPLETED") {
    return {
      status: "completed",
      balanceFcfa,
      transactionId: intent.ledgerTransactionId,
      depositIntentId: intent.depositIntentId,
      amountFcfa: intent.amountFcfa,
    };
  }
  if (intent.status === "PENDING_PROVIDER") {
    return {
      status: "pending_provider",
      depositIntentId: intent.depositIntentId,
      amountFcfa: intent.amountFcfa,
      message:
        "Validez le paiement sur votre compte Mobile Money. Le solde se mettra à jour automatiquement.",
    };
  }
  return {
    status: "failed",
    depositIntentId: intent.depositIntentId,
    amountFcfa: intent.amountFcfa,
    failureReason: intent.failureReason ?? null,
  };
}

/** Dépôt sync — crédit immédiat (tests / avant PawaPay réel). */
export async function executeSyncDeposit(userId, amount, idempotencyKey) {
  if (idempotencyKey) {
    const existing = await getDepositByIdempotencyKey(userId, idempotencyKey);
    if (existing) {
      const balanceFcfa = await getUserBalance(userId);
      return { intent: existing, balanceFcfa, reused: true };
    }
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();
  const depositIntentId = randomUUID();
  const txId = randomUUID();

  const transactItems = [];

  if (idempotencyKey) {
    transactItems.push({
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: depositIdemSk(idempotencyKey),
          depositIntentId,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  }

  transactItems.push(
    {
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: depositSk(depositIntentId),
          depositIntentId,
          userId,
          amountFcfa: amount,
          status: "COMPLETED",
          idempotencyKey: idempotencyKey ?? null,
          ledgerTransactionId: txId,
          providerRef: "sync:internal",
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    {
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: txSk(nowMs, txId),
          transactionId: txId,
          userId,
          type: "DEPOSIT",
          amountFcfa: amount,
          counterpartyName: "Rechargement",
          counterpartyPhone: null,
          createdAt: now,
        },
      },
    },
    {
      Update: {
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: "BALANCE" },
        UpdateExpression:
          "SET balanceFcfa = if_not_exists(balanceFcfa, :zero) + :amt, updatedAt = :now",
        ExpressionAttributeValues: {
          ":amt": amount,
          ":zero": 0,
          ":now": now,
        },
        ConditionExpression: "attribute_exists(PK)",
      },
    },
  );

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (idempotencyKey && err?.name === "TransactionCanceledException") {
      const raced = await getDepositByIdempotencyKey(userId, idempotencyKey);
      if (raced) {
        const balanceFcfa = await getUserBalance(userId);
        return { intent: raced, balanceFcfa, reused: true };
      }
    }
    throw err;
  }

  const intent = await getDepositIntent(userId, depositIntentId);
  const balanceFcfa = await getUserBalance(userId);
  return { intent, balanceFcfa, reused: false };
}

export async function createPendingDepositIntent(userId, amount, idempotencyKey, pawapayDepositId) {
  const now = new Date().toISOString();
  const depositIntentId = randomUUID();
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userPk(userId),
        SK: depositSk(depositIntentId),
        depositIntentId,
        userId,
        amountFcfa: amount,
        status: "PENDING_PROVIDER",
        idempotencyKey: idempotencyKey ?? null,
        pawapayDepositId,
        providerRef: "pawapay:init",
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  if (idempotencyKey) {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: depositIdemSk(idempotencyKey),
          depositIntentId,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  }
  return depositIntentId;
}

export async function updateDepositIntent(depositIntentId, userId, patch) {
  const existing = await getDepositIntent(userId, depositIntentId);
  if (!existing) return null;
  const now = new Date().toISOString();
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        ...existing,
        ...patch,
        updatedAt: now,
      },
    }),
  );
  return getDepositIntent(userId, depositIntentId);
}

export async function findDepositByPawapayId(pawapayDepositId) {
  // Scan alternative: store GSI later; for MVP query by known user from webhook body depositId lookup
  // Store mapping: PK IDEM#pawapay#depositId SK META -> userId, depositIntentId
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: pawapayIdemPk(pawapayDepositId), SK: "META" },
    }),
  );
  if (!res.Item) return null;
  return getDepositIntent(res.Item.userId, res.Item.depositIntentId);
}

export async function linkPawapayDeposit(pawapayDepositId, userId, depositIntentId) {
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: pawapayIdemPk(pawapayDepositId),
        SK: "META",
        pawapayDepositId,
        userId,
        depositIntentId,
      },
    }),
  );
}

/** Crédit atomique après callback PawaPay COMPLETED. */
export async function finalizePawapayDeposit(pawapayDepositId) {
  const mapping = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: pawapayIdemPk(pawapayDepositId), SK: "META" },
    }),
  );
  if (!mapping.Item) {
    // Fallback: scan deposit items — expensive; require linkPawapayDeposit on init
    return { ok: false, reason: "not_found" };
  }

  const { userId, depositIntentId } = mapping.Item;
  const intent = await getDepositIntent(userId, depositIntentId);
  if (!intent || intent.status !== "PENDING_PROVIDER") {
    return { ok: true, skipped: true };
  }

  const processed = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: pawapayIdemPk(pawapayDepositId), SK: "DONE" },
    }),
  );
  if (processed.Item) return { ok: true, skipped: true };

  const now = new Date().toISOString();
  const nowMs = Date.now();
  const txId = randomUUID();
  const amount = intent.amountFcfa;

  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: getTableName(),
            Item: {
              PK: pawapayIdemPk(pawapayDepositId),
              SK: "DONE",
              processedAt: now,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Update: {
            TableName: getTableName(),
            Key: { PK: userPk(userId), SK: depositSk(depositIntentId) },
            UpdateExpression:
              "SET #st = :completed, ledgerTransactionId = :tx, providerRef = :ref, updatedAt = :now",
            ConditionExpression: "#st = :pending",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":completed": "COMPLETED",
              ":pending": "PENDING_PROVIDER",
              ":tx": txId,
              ":ref": `pawapay:${pawapayDepositId}`,
              ":now": now,
            },
          },
        },
        {
          Put: {
            TableName: getTableName(),
            Item: {
              PK: userPk(userId),
              SK: txSk(nowMs, txId),
              transactionId: txId,
              userId,
              type: "DEPOSIT",
              amountFcfa: amount,
              counterpartyName: "Rechargement",
              counterpartyPhone: null,
              createdAt: now,
            },
          },
        },
        {
          Update: {
            TableName: getTableName(),
            Key: { PK: userPk(userId), SK: "BALANCE" },
            UpdateExpression:
              "SET balanceFcfa = if_not_exists(balanceFcfa, :zero) + :amt, updatedAt = :now",
            ExpressionAttributeValues: {
              ":amt": amount,
              ":zero": 0,
              ":now": now,
            },
            ConditionExpression: "attribute_exists(PK)",
          },
        },
      ],
    }),
  );

  return { ok: true };
}

export async function failPawapayDeposit(pawapayDepositId, reason) {
  const mapping = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: pawapayIdemPk(pawapayDepositId), SK: "META" },
    }),
  );
  if (!mapping.Item) return { ok: false };
  const { userId, depositIntentId } = mapping.Item;
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: depositSk(depositIntentId) },
      UpdateExpression: "SET #st = :failed, failureReason = :reason, updatedAt = :now",
      ConditionExpression: "#st = :pending",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":failed": "FAILED",
        ":pending": "PENDING_PROVIDER",
        ":reason": String(reason || "Échec du dépôt").slice(0, 500),
        ":now": new Date().toISOString(),
      },
    }),
  );
  return { ok: true };
}

export async function executePayment(
  userId,
  amount,
  recipientName,
  recipientPhone,
  idempotencyKey,
) {
  if (!isValidTxAmount(amount)) {
    return { error: "AMOUNT_INVALID" };
  }

  if (idempotencyKey) {
    const cached = await getPayIdempotencyResult(userId, idempotencyKey);
    if (cached) return { ...cached, reused: true };
  }

  const balanceBefore = await getUserBalance(userId);
  if (balanceBefore < amount) {
    return { error: "INSUFFICIENT_BALANCE" };
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();
  const txId = randomUUID();
  const transactItems = [];

  if (idempotencyKey) {
    transactItems.push({
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: payIdemSk(idempotencyKey),
          createdAt: now,
          pending: true,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  }

  transactItems.push(
    {
      Update: {
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: "BALANCE" },
        UpdateExpression: "SET balanceFcfa = balanceFcfa - :amt, updatedAt = :now",
        ConditionExpression: "balanceFcfa >= :amt",
        ExpressionAttributeValues: {
          ":amt": amount,
          ":now": now,
        },
      },
    },
    {
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: txSk(nowMs, txId),
          transactionId: txId,
          userId,
          type: "PAYMENT",
          amountFcfa: amount,
          counterpartyName: recipientName,
          counterpartyPhone: recipientPhone,
          createdAt: now,
        },
      },
    },
  );

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (idempotencyKey && err?.name === "TransactionCanceledException") {
      const cached = await getPayIdempotencyResult(userId, idempotencyKey);
      if (cached) return { ...cached, reused: true };
    }
    if (err?.name === "TransactionCanceledException") {
      return { error: "INSUFFICIENT_BALANCE" };
    }
    throw err;
  }

  const balanceFcfa = await getUserBalance(userId);

  if (idempotencyKey) {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: payIdemSk(idempotencyKey),
          balanceFcfa,
          createdAt: now,
        },
      }),
    );
  }

  return { balanceFcfa, reused: false };
}

export async function listTransactions(userId, limit = 100) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :tx)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":tx": "TX#",
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  const items = (res.Items ?? []).map((t) => ({
    id: t.transactionId,
    type: t.type === "DEPOSIT" ? "received" : "sent",
    amountFcfa: t.amountFcfa,
    counterpartyName:
      t.counterpartyName ||
      (t.type === "DEPOSIT" ? "Rechargement" : "Paiement"),
    counterpartyPhone: t.counterpartyPhone ?? null,
    createdAt: t.createdAt,
  }));
  return items;
}

export function verifyPawapayWebhookSignature(rawBody, signatureHeader) {
  const mode = (process.env.PAWAPAY_WEBHOOK_VERIFY || "none").toLowerCase();
  if (mode === "none") return true;
  if (mode !== "hmac") return false;
  const secret = (process.env.PAWAPAY_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(String(signatureHeader ?? "").trim(), "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}