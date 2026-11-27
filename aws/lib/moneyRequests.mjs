import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { emitAdminEvent } from "./adminEvents.mjs";
import { adjustBalance } from "./adminActions.mjs";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { getUserBalance, getUserProfile, userPk } from "./user.mjs";
import { isValidTxAmount } from "./wallet.mjs";

const doc = getDocClient();
const T = () => getTableName();

function metaKey(requestId) {
  return { PK: `MONEYREQ#${requestId}`, SK: "META" };
}

function pendingKey(createdAt, requestId) {
  return { PK: "MONEYREQ#PENDING", SK: `${createdAt}#${requestId}` };
}

function userSk(createdAt, requestId) {
  return `MONEYREQ#${createdAt}#${requestId}`;
}

function publicItem(item, extra = {}) {
  return {
    requestId: item.requestId,
    userId: item.userId,
    kind: item.kind,
    amountFcfa: item.amountFcfa,
    phone: item.phone || "",
    name: item.name || "",
    status: item.status,
    createdAt: item.createdAt,
    confirmedAt: item.confirmedAt || null,
    transactionId: item.transactionId || null,
    ...extra,
  };
}

async function getMeta(requestId) {
  const res = await doc.send(new GetCommand({ TableName: T(), Key: metaKey(requestId) }));
  return res.Item ?? null;
}

export async function createMoneyRequest({ userId, requestId, kind, amountFcfa, phone }) {
  const id = String(requestId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "ID_INVALID" };
  }
  if (kind !== "deposit" && kind !== "withdrawal") return { error: "KIND_INVALID" };
  const amount = Math.floor(Number(amountFcfa));
  if (!isValidTxAmount(amount)) return { error: "AMOUNT_INVALID" };

  const existing = await getMeta(id);
  if (existing) {
    if (existing.userId !== userId) return { error: "FORBIDDEN" };
    return { item: publicItem(existing), reused: true };
  }

  const profile = await getUserProfile(userId);
  if (!profile) return { error: "USER_NOT_FOUND" };
  const now = new Date().toISOString();
  const shownPhone = String(phone || profile.phone || "").replace(/\s/g, "").slice(0, 20);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim().slice(0, 80);
  const item = {
    requestId: id,
    userId,
    kind,
    amountFcfa: amount,
    phone: shownPhone,
    name,
    status: "pending",
    createdAt: now,
    userSk: userSk(now, id),
    pendingSk: `${now}#${id}`,
  };

  await doc.send(
    new PutCommand({
      TableName: T(),
      Item: { ...metaKey(id), ...item },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  await doc.send(
    new PutCommand({
      TableName: T(),
      Item: { PK: userPk(userId), SK: item.userSk, ...item },
    }),
  );
  await doc.send(
    new PutCommand({
      TableName: T(),
      Item: { ...pendingKey(now, id), ...item },
    }),
  );
  await emitAdminEvent({
    type: kind,
    userId,
    data: {
      requestId: id,
      amountFcfa: amount,
      status: "en attente",
      phone: shownPhone,
      destination: shownPhone,
    },
  });
  return { item: publicItem(item), reused: false };
}

export async function listUserMoneyRequests(userId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": userPk(userId), ":sk": "MONEYREQ#" },
      ScanIndexForward: false,
      Limit: 40,
    }),
  );
  const balance = await getUserBalance(userId);
  const items = [];
  for (const row of res.Items ?? []) {
    const meta = await getMeta(row.requestId);
    if (meta && meta.userId === userId) {
      items.push(
        publicItem(meta, meta.status === "confirmed" ? { balanceAfterFcfa: balance } : {}),
      );
    }
  }
  return items;
}

export async function listPendingMoneyRequests() {
  const res = await doc.send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "MONEYREQ#PENDING" },
      ScanIndexForward: false,
      Limit: 80,
    }),
  );
  return (res.Items ?? []).map((row) => publicItem(row));
}

async function markClosed(item, status, extra = {}) {
  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: metaKey(item.requestId),
      UpdateExpression:
        "SET #st = :st, confirmedAt = :at, transactionId = :tx",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":st": status,
        ":at": now,
        ":tx": extra.transactionId ?? null,
      },
    }),
  );
  await doc.send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: userPk(item.userId), SK: item.userSk },
      UpdateExpression: "SET #st = :st, confirmedAt = :at, transactionId = :tx",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":st": status,
        ":at": now,
        ":tx": extra.transactionId ?? null,
      },
    }),
  );
  if (item.pendingSk) {
    await doc.send(
      new DeleteCommand({
        TableName: T(),
        Key: { PK: "MONEYREQ#PENDING", SK: item.pendingSk },
      }),
    );
  }
  return now;
}

export async function confirmMoneyRequest({ requestId, admin, ip }) {
  const item = await getMeta(String(requestId ?? "").trim());
  if (!item) return { error: "NOT_FOUND" };
  if (item.status === "confirmed") {
    const balanceAfterFcfa = await getUserBalance(item.userId);
    return { ok: true, reused: true, item: publicItem(item, { balanceAfterFcfa }) };
  }
  if (item.status !== "pending") return { error: "NOT_PENDING" };
  const idem = `mreq${String(item.requestId).replace(/-/g, "")}`;
  const res = await adjustBalance({
    userId: item.userId,
    direction: item.kind === "deposit" ? "credit" : "debit",
    amountFcfa: item.amountFcfa,
    reason: item.kind === "deposit" ? "Recharge confirmée" : "Retrait confirmé",
    idempotencyKey: idem,
    admin,
    ip,
  });
  if (res.error) return res;
  const confirmedAt = await markClosed(item, "confirmed", { transactionId: res.transactionId ?? null });
  return {
    ok: true,
    reused: false,
    item: publicItem(
      { ...item, status: "confirmed", confirmedAt, transactionId: res.transactionId ?? null },
      { balanceAfterFcfa: res.balanceAfterFcfa },
    ),
  };
}

export async function rejectMoneyRequest({ requestId }) {
  const item = await getMeta(String(requestId ?? "").trim());
  if (!item) return { error: "NOT_FOUND" };
  if (item.status === "rejected") return { ok: true, reused: true, item: publicItem(item) };
  if (item.status !== "pending") return { error: "NOT_PENDING" };
  const confirmedAt = await markClosed(item, "rejected");
  return { ok: true, item: publicItem({ ...item, status: "rejected", confirmedAt }) };
}
