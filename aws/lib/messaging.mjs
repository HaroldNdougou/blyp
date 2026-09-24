import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { normalizeCameroonPhone } from "./phone.mjs";
import {
  getUserBalance,
  getUserIdByPhone,
  getUserProfile,
  userPk,
} from "./user.mjs";
import { isValidTxAmount } from "./wallet.mjs";

const doc = getDocClient();

/** Escrow non claimé : remboursement auto après 7 jours (job / claim path). */
export const MONEY_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function convPk(conversationId) {
  return `CONV#${conversationId}`;
}

function mtPk(transferId) {
  return `MT#${transferId}`;
}

function inboxSk(conversationId) {
  return `INBOX#${conversationId}`;
}

function memberSk(memberKey) {
  return `MEMBER#${memberKey}`;
}

function msgSk(createdAtMs, messageId) {
  return `MSG#${String(createdAtMs).padStart(13, "0")}#${messageId}`;
}

function phonePendingSk(transferId) {
  return `PENDING_MT#${transferId}`;
}

function moneyIdemSk(idempotencyKey) {
  return `IDEM#money#${idempotencyKey}`;
}

function phoneDigitsKey(e164OrDigits) {
  const d = String(e164OrDigits ?? "").replace(/\D/g, "");
  return d.slice(-9);
}

export function memberKeyForUser(userId) {
  return `u:${userId}`;
}

export function memberKeyForPhone(phoneE164) {
  return `p:${phoneDigitsKey(phoneE164)}`;
}

/** ID stable pour un DM (ordre des clés indépendant). */
export function directConversationId(keyA, keyB) {
  const [a, b] = [keyA, keyB].sort();
  return `dm_${a}__${b}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function displayNameFromProfile(profile, fallbackPhone) {
  const f = profile?.firstName?.trim() ?? "";
  const l = profile?.lastName?.trim() ?? "";
  const name = `${f} ${l}`.trim();
  if (name) return name;
  return fallbackPhone || "Blyp";
}

async function getConversationMeta(conversationId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: convPk(conversationId), SK: "META" },
    }),
  );
  return res.Item ?? null;
}

async function assertMember(conversationId, userId) {
  const key = memberKeyForUser(userId);
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: convPk(conversationId), SK: memberSk(key) },
    }),
  );
  return res.Item ?? null;
}

function transferPublic(t) {
  return {
    transferId: t.transferId,
    amountFcfa: t.amountFcfa,
    status: String(t.status || "pending").toLowerCase(),
    fromUserId: t.fromUserId,
    toUserId: t.toUserId ?? null,
    toPhone: t.toPhone,
    expiresAt: t.expiresAt,
    claimedAt: t.claimedAt ?? null,
    createdAt: t.createdAt,
  };
}

function messagePublic(m) {
  return {
    id: m.messageId,
    conversationId: m.conversationId,
    senderUserId: m.senderUserId,
    type: m.type,
    body: m.body ?? null,
    moneyTransfer: m.moneyTransfer ?? null,
    createdAt: m.createdAt,
    clientId: m.clientId ?? null,
  };
}

/**
 * Ouvre (ou retrouve) une conversation directe avec un numéro CM.
 */
export async function openDirectConversation(fromUserId, rawPhone) {
  const phone = normalizeCameroonPhone(rawPhone);
  if (!phone) return { error: "PHONE_INVALID" };

  const fromProfile = await getUserProfile(fromUserId);
  if (!fromProfile) return { error: "USER_NOT_FOUND" };
  if (fromProfile.phone === phone) return { error: "SELF" };

  const toUserId = await getUserIdByPhone(phone);
  const myKey = memberKeyForUser(fromUserId);
  const theirKey = toUserId
    ? memberKeyForUser(toUserId)
    : memberKeyForPhone(phone);
  const conversationId = directConversationId(myKey, theirKey);

  const existing = await getConversationMeta(conversationId);
  if (existing) {
    return { conversation: await conversationListItem(fromUserId, conversationId) };
  }

  const now = new Date().toISOString();
  const toProfile = toUserId ? await getUserProfile(toUserId) : null;
  const theirName = toProfile
    ? displayNameFromProfile(toProfile, phone)
    : phone;
  const myName = displayNameFromProfile(fromProfile, fromProfile.phone);

  const members = [
    {
      memberKey: myKey,
      userId: fromUserId,
      phone: fromProfile.phone,
      displayName: myName,
    },
    {
      memberKey: theirKey,
      userId: toUserId,
      phone,
      displayName: theirName,
    },
  ];

  const transactItems = [
    {
      Put: {
        TableName: getTableName(),
        Item: {
          PK: convPk(conversationId),
          SK: "META",
          entityType: "CONVERSATION",
          conversationId,
          type: "direct",
          createdAt: now,
          updatedAt: now,
          lastMessagePreview: "",
          lastMessageType: null,
          lastMessageAt: null,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];

  for (const m of members) {
    transactItems.push({
      Put: {
        TableName: getTableName(),
        Item: {
          PK: convPk(conversationId),
          SK: memberSk(m.memberKey),
          entityType: "MEMBER",
          conversationId,
          memberKey: m.memberKey,
          userId: m.userId,
          phone: m.phone,
          displayName: m.displayName,
          joinedAt: now,
        },
      },
    });
    if (m.userId) {
      transactItems.push({
        Put: {
          TableName: getTableName(),
          Item: {
            PK: userPk(m.userId),
            SK: inboxSk(conversationId),
            entityType: "INBOX",
            conversationId,
            updatedAt: now,
            lastMessagePreview: "",
            lastMessageType: null,
            lastMessageAt: null,
            peerName: m.userId === fromUserId ? theirName : myName,
            peerPhone: m.userId === fromUserId ? phone : fromProfile.phone,
            peerUserId:
              m.userId === fromUserId ? toUserId : fromUserId,
          },
        },
      });
    }
  }

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      const again = await getConversationMeta(conversationId);
      if (again) {
        return {
          conversation: await conversationListItem(fromUserId, conversationId),
        };
      }
    }
    throw err;
  }

  return {
    conversation: await conversationListItem(fromUserId, conversationId),
  };
}

async function conversationListItem(userId, conversationId) {
  const inbox = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: inboxSk(conversationId) },
    }),
  );
  const meta = await getConversationMeta(conversationId);
  if (!meta) return null;
  const item = inbox.Item ?? {};
  return {
    id: conversationId,
    type: meta.type || "direct",
    peerName: item.peerName || "Contact",
    peerPhone: item.peerPhone || null,
    peerUserId: item.peerUserId ?? null,
    lastMessagePreview: item.lastMessagePreview ?? meta.lastMessagePreview ?? "",
    lastMessageType: item.lastMessageType ?? meta.lastMessageType ?? null,
    lastMessageAt: item.lastMessageAt ?? meta.lastMessageAt ?? meta.updatedAt,
    updatedAt: item.updatedAt ?? meta.updatedAt,
  };
}

export async function listConversations(userId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":sk": "INBOX#",
      },
    }),
  );
  const items = (res.Items ?? [])
    .map((it) => ({
      id: it.conversationId,
      type: "direct",
      peerName: it.peerName || "Contact",
      peerPhone: it.peerPhone || null,
      peerUserId: it.peerUserId ?? null,
      lastMessagePreview: it.lastMessagePreview || "",
      lastMessageType: it.lastMessageType ?? null,
      lastMessageAt: it.lastMessageAt || it.updatedAt,
      updatedAt: it.updatedAt,
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return items;
}

export async function listMessages(userId, conversationId, limit = 80) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":sk": "MSG#",
      },
      ScanIndexForward: true,
      Limit: limit,
    }),
  );

  const messages = [];
  for (const m of res.Items ?? []) {
    let moneyTransfer = null;
    if (m.type === "money" && m.transferId) {
      const t = await doc.send(
        new GetCommand({
          TableName: getTableName(),
          Key: { PK: mtPk(m.transferId), SK: "META" },
        }),
      );
      if (t.Item) moneyTransfer = transferPublic(t.Item);
    }
    messages.push(
      messagePublic({
        ...m,
        moneyTransfer,
      }),
    );
  }
  return { messages };
}

function senderLabel(profile) {
  const name = `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim();
  return name || "Blyp";
}

/** Push destinataire — hors chemin critique (SQS). */
async function notifyMessagePush(conversationId, senderUserId, messageId, body) {
  try {
    const { enqueueMessageReceivedPush } = await import("./pushQueue.mjs");
    const members = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":sk": "MEMBER#",
        },
      }),
    );
    const sender = await getUserProfile(senderUserId);
    const fromName = senderLabel(sender);
    for (const mem of members.Items ?? []) {
      if (!mem.userId || mem.userId === senderUserId) continue;
      await enqueueMessageReceivedPush({
        recipientUserId: mem.userId,
        conversationId,
        messageId,
        fromName,
        body,
      });
    }
  } catch (err) {
    console.warn("[messaging] push notify failed", err?.message ?? err);
  }
}

async function updateInboxes(conversationId, preview, messageType, now) {
  const members = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":sk": "MEMBER#",
      },
    }),
  );

  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: convPk(conversationId), SK: "META" },
      UpdateExpression:
        "SET updatedAt = :now, lastMessagePreview = :p, lastMessageType = :t, lastMessageAt = :now",
      ExpressionAttributeValues: {
        ":now": now,
        ":p": preview,
        ":t": messageType,
      },
    }),
  );

  for (const mem of members.Items ?? []) {
    if (!mem.userId) continue;
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: userPk(mem.userId), SK: inboxSk(conversationId) },
        UpdateExpression:
          "SET updatedAt = :now, lastMessagePreview = :p, lastMessageType = :t, lastMessageAt = :now",
        ExpressionAttributeValues: {
          ":now": now,
          ":p": preview,
          ":t": messageType,
        },
      }),
    );
  }
}

export async function sendTextMessage(
  userId,
  conversationId,
  body,
  clientId,
) {
  const text = String(body ?? "").trim();
  if (!text || text.length > 2000) return { error: "BODY_INVALID" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const messageId = randomUUID();

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: convPk(conversationId),
        SK: msgSk(nowMs, messageId),
        entityType: "MESSAGE",
        messageId,
        conversationId,
        senderUserId: userId,
        type: "text",
        body: text,
        createdAt: now,
        clientId: clientId || null,
      },
    }),
  );

  const preview = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  await updateInboxes(conversationId, preview, "text", now);
  await notifyMessagePush(conversationId, userId, messageId, preview);

  return {
    message: messagePublic({
      messageId,
      conversationId,
      senderUserId: userId,
      type: "text",
      body: text,
      createdAt: now,
      clientId: clientId || null,
      moneyTransfer: null,
    }),
  };
}

export async function sendMoneyMessage(
  userId,
  conversationId,
  amount,
  clientId,
  idempotencyKey,
) {
  if (!isValidTxAmount(amount)) return { error: "AMOUNT_INVALID" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  if (idempotencyKey) {
    const cached = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: moneyIdemSk(idempotencyKey) },
      }),
    );
    if (cached.Item?.message) {
      return { message: cached.Item.message, balanceFcfa: cached.Item.balanceFcfa, reused: true };
    }
  }

  const membersRes = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":sk": "MEMBER#",
      },
    }),
  );
  const peers = (membersRes.Items ?? []).filter((m) => m.userId !== userId);
  const peer = peers[0];
  if (!peer?.phone) return { error: "PEER_MISSING" };

  const toPhone = peer.phone;
  let toUserId = peer.userId ?? null;
  if (!toUserId) {
    toUserId = await getUserIdByPhone(toPhone);
  }

  const balanceBefore = await getUserBalance(userId);
  if (balanceBefore < amount) return { error: "INSUFFICIENT_BALANCE" };

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + MONEY_TRANSFER_TTL_MS).toISOString();
  const transferId = randomUUID();
  const messageId = randomUUID();
  const preview = `💰 ${amount.toLocaleString("fr-FR")} FCFA`;

  const transferItem = {
    PK: mtPk(transferId),
    SK: "META",
    entityType: "MONEY_TRANSFER",
    transferId,
    conversationId,
    messageId,
    fromUserId: userId,
    toUserId,
    toPhone,
    amountFcfa: amount,
    status: "pending",
    createdAt: now,
    expiresAt,
  };

  const messageItem = {
    PK: convPk(conversationId),
    SK: msgSk(nowMs, messageId),
    entityType: "MESSAGE",
    messageId,
    conversationId,
    senderUserId: userId,
    type: "money",
    transferId,
    body: null,
    createdAt: now,
    clientId: clientId || null,
  };

  const transactItems = [
    {
      Update: {
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: "BALANCE" },
        UpdateExpression: "SET balanceFcfa = balanceFcfa - :amt, updatedAt = :now",
        ConditionExpression: "balanceFcfa >= :amt",
        ExpressionAttributeValues: { ":amt": amount, ":now": now },
      },
    },
    {
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: `TX#${String(nowMs).padStart(13, "0")}#${transferId}`,
          transactionId: transferId,
          userId,
          type: "MONEY_SEND",
          amountFcfa: amount,
          counterpartyName: peer.displayName || toPhone,
          counterpartyPhone: toPhone,
          createdAt: now,
        },
      },
    },
    { Put: { TableName: getTableName(), Item: transferItem } },
    { Put: { TableName: getTableName(), Item: messageItem } },
  ];

  if (idempotencyKey) {
    transactItems.unshift({
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: moneyIdemSk(idempotencyKey),
          pending: true,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  }

  if (!toUserId) {
    transactItems.push({
      Put: {
        TableName: getTableName(),
        Item: {
          PK: `PHONE#${toPhone}`,
          SK: phonePendingSk(transferId),
          transferId,
          conversationId,
          createdAt: now,
        },
      },
    });
  }

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (idempotencyKey && err?.name === "TransactionCanceledException") {
      const cached = await doc.send(
        new GetCommand({
          TableName: getTableName(),
          Key: { PK: userPk(userId), SK: moneyIdemSk(idempotencyKey) },
        }),
      );
      if (cached.Item?.message) {
        return {
          message: cached.Item.message,
          balanceFcfa: cached.Item.balanceFcfa,
          reused: true,
        };
      }
    }
    if (err?.name === "TransactionCanceledException") {
      return { error: "INSUFFICIENT_BALANCE" };
    }
    throw err;
  }

  await updateInboxes(conversationId, preview, "money", now);
  await notifyMessagePush(conversationId, userId, messageId, preview);
  const balanceFcfa = await getUserBalance(userId);
  const message = messagePublic({
    ...messageItem,
    moneyTransfer: transferPublic(transferItem),
  });

  if (idempotencyKey) {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: userPk(userId),
          SK: moneyIdemSk(idempotencyKey),
          message,
          balanceFcfa,
          createdAt: now,
        },
      }),
    );
  }

  return { message, balanceFcfa, reused: false };
}

export async function claimMoneyTransfer(claimerUserId, transferId) {
  const tRes = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(transferId), SK: "META" },
    }),
  );
  const t = tRes.Item;
  if (!t) return { error: "NOT_FOUND" };
  if (t.status !== "pending") return { error: "NOT_PENDING", transfer: transferPublic(t) };

  if (Date.parse(t.expiresAt) <= Date.now()) {
    await expireMoneyTransfer(transferId);
    return { error: "EXPIRED" };
  }

  const claimer = await getUserProfile(claimerUserId);
  if (!claimer) return { error: "USER_NOT_FOUND" };

  const claimerPhone = claimer.phone;
  const allowed =
    t.toUserId === claimerUserId ||
    (!t.toUserId && t.toPhone === claimerPhone);
  if (!allowed) return { error: "FORBIDDEN" };
  if (t.fromUserId === claimerUserId) return { error: "SELF" };

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const transactItems = [
    {
      Update: {
        TableName: getTableName(),
        Key: { PK: mtPk(transferId), SK: "META" },
        UpdateExpression:
          "SET #st = :claimed, claimedAt = :now, claimedByUserId = :uid, toUserId = :uid",
        ConditionExpression: "#st = :pending",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":claimed": "claimed",
          ":pending": "pending",
          ":now": now,
          ":uid": claimerUserId,
        },
      },
    },
    {
      Update: {
        TableName: getTableName(),
        Key: { PK: userPk(claimerUserId), SK: "BALANCE" },
        UpdateExpression:
          "SET balanceFcfa = if_not_exists(balanceFcfa, :z) + :amt, updatedAt = :now",
        ExpressionAttributeValues: {
          ":amt": t.amountFcfa,
          ":now": now,
          ":z": 0,
        },
      },
    },
    {
      Put: {
        TableName: getTableName(),
        Item: {
          PK: userPk(claimerUserId),
          SK: `TX#${String(nowMs).padStart(13, "0")}#${transferId}`,
          transactionId: transferId,
          userId: claimerUserId,
          type: "MONEY_CLAIM",
          amountFcfa: t.amountFcfa,
          counterpartyName: "Message Money",
          counterpartyPhone: null,
          createdAt: now,
        },
      },
    },
  ];

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      const again = await doc.send(
        new GetCommand({
          TableName: getTableName(),
          Key: { PK: mtPk(transferId), SK: "META" },
        }),
      );
      if (again.Item?.status === "claimed") {
        return {
          transfer: transferPublic(again.Item),
          balanceFcfa: await getUserBalance(claimerUserId),
          reused: true,
        };
      }
      return { error: "CONFLICT" };
    }
    throw err;
  }

  if (!t.toUserId) {
    try {
      await doc.send(
        new UpdateCommand({
          TableName: getTableName(),
          Key: {
            PK: `PHONE#${t.toPhone}`,
            SK: phonePendingSk(transferId),
          },
          UpdateExpression: "SET claimed = :t",
          ExpressionAttributeValues: { ":t": true },
        }),
      );
    } catch {
      /* best effort */
    }
  }

  const balanceFcfa = await getUserBalance(claimerUserId);
  const updated = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(transferId), SK: "META" },
    }),
  );
  return { transfer: transferPublic(updated.Item), balanceFcfa, reused: false };
}

export async function expireMoneyTransfer(transferId) {
  const tRes = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(transferId), SK: "META" },
    }),
  );
  const t = tRes.Item;
  if (!t || t.status !== "pending") return { ok: false };

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: getTableName(),
              Key: { PK: mtPk(transferId), SK: "META" },
              UpdateExpression: "SET #st = :expired, expiredAt = :now",
              ConditionExpression: "#st = :pending",
              ExpressionAttributeNames: { "#st": "status" },
              ExpressionAttributeValues: {
                ":expired": "expired",
                ":pending": "pending",
                ":now": now,
              },
            },
          },
          {
            Update: {
              TableName: getTableName(),
              Key: { PK: userPk(t.fromUserId), SK: "BALANCE" },
              UpdateExpression:
                "SET balanceFcfa = if_not_exists(balanceFcfa, :z) + :amt, updatedAt = :now",
              ExpressionAttributeValues: {
                ":amt": t.amountFcfa,
                ":now": now,
                ":z": 0,
              },
            },
          },
          {
            Put: {
              TableName: getTableName(),
              Item: {
                PK: userPk(t.fromUserId),
                SK: `TX#${String(nowMs).padStart(13, "0")}#exp${transferId}`,
                transactionId: `exp-${transferId}`,
                userId: t.fromUserId,
                type: "MONEY_EXPIRE_REFUND",
                amountFcfa: t.amountFcfa,
                counterpartyName: "Message Money (expiré)",
                counterpartyPhone: t.toPhone,
                createdAt: now,
              },
            },
          },
        ],
      }),
    );
  } catch {
    return { ok: false };
  }
  return { ok: true };
}
