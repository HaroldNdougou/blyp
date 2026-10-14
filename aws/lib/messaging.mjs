import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { normalizeCameroonPhone, normalizePeerPhoneE164 } from "./phone.mjs";
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

export async function assertMember(conversationId, userId) {
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
    conversationId: t.conversationId ?? null,
    amountFcfa: t.amountFcfa,
    status: String(t.status || "pending").toLowerCase(),
    fromUserId: t.fromUserId,
    toUserId: t.toUserId ?? null,
    toPhone: t.toPhone,
    expiresAt: t.expiresAt,
    claimedAt: t.claimedAt ?? null,
    claimedByUserId: t.claimedByUserId ?? null,
    claimedByFirstName: t.claimedByFirstName ?? null,
    thanksUserId: t.thanksUserId ?? null,
    thanksFirstName: t.thanksFirstName ?? null,
    createdAt: t.createdAt,
  };
}

function reactSk(messageId) {
  return `REACT#${messageId}`;
}

function hideSkForUser(userId, messageId) {
  return `HID#${memberKeyForUser(userId)}#${messageId}`;
}

/** Fenêtre « supprimer pour tout le monde » (comme WhatsApp). */
const DELETE_FOR_ALL_MAX_MS = 60 * 60 * 1000;

async function loadHiddenMessageIds(conversationId, userId) {
  const prefix = `HID#${memberKeyForUser(userId)}#`;
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":sk": prefix,
      },
    }),
  );
  const out = new Set();
  for (const item of res.Items ?? []) {
    const mid = String(item.messageId ?? "").trim();
    if (mid) out.add(mid);
  }
  return out;
}

const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);
const REACTION_SYNC_PREFIXES = ["BLYP_R|", "\u200b\u200bR|"];

function parseReactionSyncBody(body) {
  const raw = String(body ?? "").trim();
  let rest = "";
  for (const p of REACTION_SYNC_PREFIXES) {
    if (raw.startsWith(p)) {
      rest = raw.slice(p.length);
      break;
    }
  }
  if (!rest) return null;
  const sep = rest.lastIndexOf("|");
  if (sep < 0) return null;
  const messageId = rest.slice(0, sep).trim();
  const emoji = rest.slice(sep + 1);
  if (!messageId) return null;
  if (emoji && !REACTION_EMOJIS.has(emoji)) return null;
  return { messageId, emoji };
}

function reactionNotifBody(emoji) {
  return emoji ? `a réagi ${emoji} à votre message` : "a réagi à votre message";
}

function reactionsPublic(map) {
  if (!map || typeof map !== "object") return [];
  const out = [];
  for (const [userId, emoji] of Object.entries(map)) {
    if (!userId || typeof emoji !== "string" || !emoji) continue;
    out.push({ userId, emoji });
  }
  return out;
}

function replyToPublic(m) {
  const messageId = String(m.replyToMessageId ?? "").trim();
  if (!messageId) return null;
  return {
    messageId,
    senderUserId: String(m.replyToSenderUserId ?? ""),
    type: m.replyToType ?? "text",
    preview: m.replyToPreview ?? null,
  };
}

function buildReplyPreview(m, moneyTransfer) {
  const type = m.type ?? "text";
  if (type === "text") {
    const raw = String(m.body ?? "").trim();
    if (!raw) return null;
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  }
  if (type === "voice") return null;
  if (type === "image") {
    const cap = String(m.body ?? "").trim();
    return cap || null;
  }
  if (type === "document") {
    const cap = String(m.body ?? "").trim();
    if (cap) return cap.length > 120 ? `${cap.slice(0, 117)}…` : cap;
    const name = String(m.documentFileName ?? "").trim();
    return name || null;
  }
  if (type === "money" && moneyTransfer?.amountFcfa != null) {
    const cap = String(m.body ?? "").trim();
    if (cap) return cap.length > 120 ? `${cap.slice(0, 117)}…` : cap;
    const amount = Number(moneyTransfer.amountFcfa) || 0;
    return `💰 ${amount.toLocaleString("fr-FR")} F`;
  }
  return null;
}

function messagePublic(m) {
  if (m.deletedForAllAt) {
    return {
      id: m.messageId,
      conversationId: m.conversationId,
      senderUserId: m.senderUserId,
      type: "text",
      body: null,
      moneyTransfer: null,
      voice: null,
      image: null,
      document: null,
      reactions: [],
      replyTo: null,
      createdAt: m.createdAt,
      clientId: m.clientId ?? null,
      deletedForAll: true,
    };
  }
  const voice =
    m.type === "voice" && m.voiceKey
      ? {
          key: m.voiceKey,
          durationMs: Number(m.voiceDurationMs) || 0,
        }
      : null;
  const image =
    m.type === "image" && m.imageKey
      ? {
          key: m.imageKey,
          width: Number(m.imageWidth) || 0,
          height: Number(m.imageHeight) || 0,
        }
      : null;
  const document =
    m.type === "document" && m.documentKey
      ? {
          key: m.documentKey,
          fileName: String(m.documentFileName ?? "").trim() || "document",
          sizeBytes: Number(m.documentSizeBytes) || 0,
          contentType: m.documentContentType
            ? String(m.documentContentType)
            : undefined,
          thumbKey: m.documentThumbKey
            ? String(m.documentThumbKey)
            : undefined,
          pageCount:
            Number(m.documentPageCount) > 0
              ? Number(m.documentPageCount)
              : undefined,
        }
      : null;
  return {
    id: m.messageId,
    conversationId: m.conversationId,
    senderUserId: m.senderUserId,
    type: m.type,
    body: m.body ?? null,
    moneyTransfer: m.moneyTransfer ?? null,
    voice,
    image,
    document,
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
    replyTo: replyToPublic(m),
    createdAt: m.createdAt,
    clientId: m.clientId ?? null,
  };
}

/**
 * Ouvre (ou retrouve) une conversation directe avec un numéro CM.
 */
export async function openDirectConversation(fromUserId, rawPhone) {
  const phone = normalizePeerPhoneE164(rawPhone);
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
    lastMessageFromSelf: Boolean(item.lastMessageFromSelf),
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
      lastMessageFromSelf: Boolean(it.lastMessageFromSelf),
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
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  const rows = [...(res.Items ?? [])].reverse();
  const reactMap = await loadConversationReactions(conversationId);
  const hidden = await loadHiddenMessageIds(conversationId, userId);

  const messages = [];
  for (const m of rows) {
    const mid = String(m.messageId ?? "").trim();
    if (mid && hidden.has(mid)) continue;
    let moneyTransfer = null;
    if (m.type === "money" && m.transferId && !m.deletedForAllAt) {
      moneyTransfer = await loadMoneyTransferPublic(m.transferId, {
        notifyOnExpire: true,
      });
    }
    messages.push(
      messagePublic({
        ...m,
        moneyTransfer,
        reactions: reactMap.get(m.messageId) ?? [],
      }),
    );
  }
  const receipts = await getPeerReceipts(conversationId, userId);
  return { messages, ...receipts };
}

async function loadConversationReactions(conversationId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":sk": "REACT#",
      },
    }),
  );
  const map = new Map();
  for (const item of res.Items ?? []) {
    const id = String(item.messageId ?? "").trim();
    if (!id) continue;
    map.set(id, reactionsPublic(item.reactions));
  }
  return map;
}

async function getConversationMessage(conversationId, messageId) {
  const mid = String(messageId ?? "").trim();
  if (!mid) return null;
  let lastKey;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        FilterExpression: "messageId = :mid",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":sk": "MSG#",
          ":mid": mid,
        },
        ExclusiveStartKey: lastKey,
        ScanIndexForward: false,
      }),
    );
    const hit = (res.Items ?? []).find(
      (item) => String(item.messageId ?? "").trim() === mid,
    );
    if (hit) return hit;
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return null;
}

async function messageExists(conversationId, messageId) {
  return Boolean(await getConversationMessage(conversationId, messageId));
}

async function resolveReplyFields(conversationId, replyToMessageId) {
  const replyMid = String(replyToMessageId ?? "").trim();
  if (!replyMid) return { replyFields: {} };
  const target = await getConversationMessage(conversationId, replyMid);
  if (!target) return { error: "REPLY_NOT_FOUND" };
  let moneyTransfer = null;
  if (target.type === "money" && target.transferId) {
    moneyTransfer = await loadMoneyTransferPublic(target.transferId, {
      notifyOnExpire: false,
    });
  }
  return {
    replyFields: {
      replyToMessageId: replyMid,
      replyToSenderUserId: target.senderUserId,
      replyToType: target.type ?? "text",
      replyToPreview: buildReplyPreview(target, moneyTransfer),
    },
  };
}

async function notifyReactionPush(conversationId, fromUserId, messageId, reactions) {
  try {
    const { enqueueMessageReactionPush } = await import("./pushQueue.mjs");
    const members = await listConvMembers(conversationId);
    for (const mem of members) {
      if (!mem.userId || mem.userId === fromUserId) continue;
      await enqueueMessageReactionPush({
        recipientUserId: mem.userId,
        conversationId,
        messageId,
        reactions,
      });
    }
  } catch (err) {
    console.warn("[messaging] reaction push failed", err?.message ?? err);
  }
}

export async function setMessageReaction(
  userId,
  conversationId,
  messageId,
  rawEmoji,
) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };
  const mid = String(messageId ?? "").trim();
  if (!mid || mid.startsWith("c-")) return { error: "NOT_FOUND" };

  let emoji = String(rawEmoji ?? "").trim();
  if (emoji && !REACTION_EMOJIS.has(emoji)) return { error: "EMOJI_INVALID" };

  const exists = await messageExists(conversationId, mid);
  if (!exists) return { error: "NOT_FOUND" };

  const key = { PK: convPk(conversationId), SK: reactSk(mid) };
  const existing = await doc.send(
    new GetCommand({ TableName: getTableName(), Key: key }),
  );
  const map = { ...(existing.Item?.reactions ?? {}) };
  const prev = map[userId];
  if (!emoji || prev === emoji) {
    delete map[userId];
  } else {
    map[userId] = emoji;
  }

  if (Object.keys(map).length === 0) {
    if (existing.Item) {
      await doc.send(
        new DeleteCommand({ TableName: getTableName(), Key: key }),
      );
    }
  } else {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: key.PK,
          SK: key.SK,
          entityType: "MESSAGE_REACTIONS",
          messageId: mid,
          conversationId,
          reactions: map,
        },
      }),
    );
  }

  const reactions = reactionsPublic(map);
  await notifyReactionPush(conversationId, userId, mid, reactions);
  return { ok: true, messageId: mid, reactions };
}

async function notifyMessageDeletedPush(
  conversationId,
  messageId,
  deletedForAll,
) {
  try {
    const { enqueueMessageDeletedPush } = await import("./pushQueue.mjs");
    const members = await listConvMembers(conversationId);
    for (const mem of members) {
      if (!mem.userId) continue;
      await enqueueMessageDeletedPush({
        recipientUserId: mem.userId,
        conversationId,
        messageId,
        deletedForAll,
      });
    }
  } catch (err) {
    console.warn("[messaging] delete push failed", err?.message ?? err);
  }
}

/**
 * @param {"me" | "everyone"} scope
 */
export async function deleteMessage(userId, conversationId, messageId, scope) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };
  const mid = String(messageId ?? "").trim();
  if (!mid || mid.startsWith("c-")) return { error: "NOT_FOUND" };
  const rawScope = String(scope ?? "me").toLowerCase();
  if (rawScope !== "me" && rawScope !== "everyone") {
    return { error: "SCOPE_INVALID" };
  }

  const row = await getConversationMessage(conversationId, mid);
  if (!row) return { error: "NOT_FOUND" };

  if (rawScope === "me") {
    const now = new Date().toISOString();
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: convPk(conversationId),
          SK: hideSkForUser(userId, mid),
          entityType: "MSG_HIDE",
          messageId: mid,
          userId,
          hiddenAt: now,
        },
      }),
    );
    return { ok: true, scope: "me", messageId: mid };
  }

  if (String(row.senderUserId ?? "") !== userId) {
    return { error: "FORBIDDEN" };
  }
  if (row.deletedForAllAt) {
    return {
      ok: true,
      scope: "everyone",
      messageId: mid,
      message: messagePublic(row),
    };
  }

  const createdMs = Date.parse(String(row.createdAt ?? ""));
  if (
    !Number.isFinite(createdMs) ||
    Date.now() - createdMs > DELETE_FOR_ALL_MAX_MS
  ) {
    return { error: "TOO_LATE" };
  }

  if (row.type === "money" && row.transferId) {
    const transfer = await loadMoneyTransferPublic(row.transferId, {
      notifyOnExpire: false,
    });
    if (transfer?.status === "pending") {
      const recall = await recallMoneyTransfer(userId, row.transferId);
      if (recall.error && recall.error !== "NOT_FOUND") {
        if (recall.error === "FORBIDDEN") return { error: "FORBIDDEN" };
        return { error: "MONEY_RECALL_FAILED" };
      }
    } else if (transfer && transfer.status !== "pending") {
      return { error: "TOO_LATE" };
    }
  }

  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: convPk(conversationId), SK: row.SK },
      UpdateExpression:
        "SET deletedForAllAt = :now, body = :empty, #type = :text REMOVE voiceKey, voiceDurationMs, imageKey, imageWidth, imageHeight, documentKey, documentFileName, documentSizeBytes, documentContentType, documentThumbKey, documentPageCount, transferId",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: {
        ":now": now,
        ":empty": null,
        ":text": "text",
      },
    }),
  );

  const reactKey = { PK: convPk(conversationId), SK: reactSk(mid) };
  try {
    await doc.send(
      new DeleteCommand({ TableName: getTableName(), Key: reactKey }),
    );
  } catch {
    /* ignore */
  }

  const updated = {
    ...row,
    deletedForAllAt: now,
    body: null,
    type: "text",
    voiceKey: null,
    imageKey: null,
    transferId: null,
    moneyTransfer: null,
  };
  const message = messagePublic(updated);
  await notifyMessageDeletedPush(conversationId, mid, true);
  return { ok: true, scope: "everyone", messageId: mid, message };
}

async function listConvMembers(conversationId) {
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
  return members.Items ?? [];
}

async function getPeerReceipts(conversationId, userId) {
  const members = await listConvMembers(conversationId);
  for (const mem of members) {
    if (!mem.userId || mem.userId === userId) continue;
    return {
      peerLastReadAt: mem.lastReadAt ?? null,
      peerLastDeliveredAt: mem.lastDeliveredAt ?? null,
    };
  }
  return { peerLastReadAt: null, peerLastDeliveredAt: null };
}

async function notifyConversationReceipt(
  conversationId,
  fromUserId,
  kind,
  at,
) {
  try {
    const { enqueueConversationReceiptPush } = await import("./pushQueue.mjs");
    const members = await listConvMembers(conversationId);
    for (const mem of members) {
      if (!mem.userId || mem.userId === fromUserId) continue;
      await enqueueConversationReceiptPush({
        recipientUserId: mem.userId,
        conversationId,
        kind,
        at,
      });
    }
  } catch (err) {
    console.warn("[messaging] receipt push failed", err?.message ?? err);
  }
}

export async function markConversationRead(userId, conversationId) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };
  const now = new Date().toISOString();
  const key = memberKeyForUser(userId);
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: convPk(conversationId), SK: memberSk(key) },
      UpdateExpression: "SET lastReadAt = :now, lastDeliveredAt = :now",
      ExpressionAttributeValues: { ":now": now },
    }),
  );
  await notifyConversationReceipt(conversationId, userId, "read", now);
  return { ok: true, at: now };
}

export async function markConversationDelivered(userId, conversationId) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };
  const now = new Date().toISOString();
  const key = memberKeyForUser(userId);
  try {
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: convPk(conversationId), SK: memberSk(key) },
        UpdateExpression: "SET lastDeliveredAt = :now",
        ConditionExpression:
          "attribute_not_exists(lastDeliveredAt) OR lastDeliveredAt < :now",
        ExpressionAttributeValues: { ":now": now },
      }),
    );
  } catch (err) {
    if (err?.name !== "ConditionalCheckFailedException") throw err;
    return { ok: true, at: now, reused: true };
  }
  await notifyConversationReceipt(conversationId, userId, "delivered", now);
  return { ok: true, at: now };
}

function senderLabel(profile) {
  const name = `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim();
  return name || "Blyp";
}

const INVITE_SMS_COOLDOWN_SEC = 24 * 60 * 60;

const DEFAULT_BLYP_DOWNLOAD_URL =
  "https://blyppay.com/download/blyp-pay.apk";

function inviteDownloadUrl() {
  return (
    String(process.env.BLYP_INVITE_URL ?? "").trim() || DEFAULT_BLYP_DOWNLOAD_URL
  );
}

/** @param {"text"|"voice"|"image"|"money"} kind */
function inviteSmsText(_profile, kind, amountFcfa) {
  const link = inviteDownloadUrl();
  if (kind === "money" && Number(amountFcfa) > 0) {
    const amt = Number(amountFcfa).toLocaleString("fr-FR");
    return `Je t’ai envoyé ${amt} FCFA sur Blyp. Connecte-toi via ce lien : ${link}`;
  }
  return `Regarde le message que je t’ai envoyé sur Blyp, connecte-toi via ce lien : ${link}`;
}

function inviteSmsSk(conversationId) {
  return `SMS_INVITE#${conversationId}`;
}

async function claimInviteSmsSlot(phone, conversationId) {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: `PHONE#${phone}`,
          SK: inviteSmsSk(conversationId),
          conversationId,
          createdAt: new Date().toISOString(),
          expiresAt: nowSec + INVITE_SMS_COOLDOWN_SEC,
        },
        ConditionExpression: "attribute_not_exists(SK) OR expiresAt < :now",
        ExpressionAttributeValues: { ":now": nowSec },
      }),
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    console.warn("[messaging] invite sms slot", err?.message ?? err);
    return false;
  }
}

async function releaseInviteSmsSlot(phone, conversationId) {
  try {
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: `PHONE#${phone}`, SK: inviteSmsSk(conversationId) },
      }),
    );
  } catch {
    /* best effort */
  }
}

/** SMS / WhatsApp si le destinataire n’a pas de compte (1 envoi / conversation / 24 h). */
async function notifyUnregisteredPeerSms(
  conversationId,
  senderUserId,
  kind = "text",
  extra = {},
) {
  try {
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
    const peers = (members.Items ?? []).filter(
      (m) => m.userId !== senderUserId,
    );
    for (const peer of peers) {
      const phone = normalizeCameroonPhone(peer.phone);
      if (!phone) continue;
      if (peer.userId) continue;
      const existing = await getUserIdByPhone(phone);
      if (existing) continue;
      const claimed = await claimInviteSmsSlot(phone, conversationId);
      if (!claimed) continue;
      const sender = await getUserProfile(senderUserId);
      const { deliverPeerInvite } = await import("./sms.mjs");
      const sent = await deliverPeerInvite(
        phone,
        inviteSmsText(sender, kind, extra.amountFcfa),
      );
      if (!sent?.ok) {
        await releaseInviteSmsSlot(phone, conversationId);
        console.warn(
          "[messaging] peer invite failed",
          sent?.reason ?? "unknown",
        );
      } else if (process.env.NODE_ENV !== "production") {
        console.log(
          `[messaging] peer invite ${sent.channel ?? "sms"} → ${phone}`,
        );
      }
    }
  } catch (err) {
    console.warn("[messaging] peer invite", err?.message ?? err);
  }
}

function queueUnregisteredPeerInvite(conversationId, senderUserId, kind, extra) {
  void notifyUnregisteredPeerSms(
    conversationId,
    senderUserId,
    kind,
    extra,
  ).catch(() => {});
}

/** Push destinataire — hors chemin critique (SQS). */
async function notifyMessagePush(
  conversationId,
  senderUserId,
  messageId,
  body,
  messageType = "text",
  extra = {},
) {
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
    const reaction = parseReactionSyncBody(body);
    if (reaction && !reaction.emoji) return;
    const pushBody = reaction ? reactionNotifBody(reaction.emoji) : body;
    const pushType = reaction ? "reaction" : messageType;
    for (const mem of members.Items ?? []) {
      if (!mem.userId || mem.userId === senderUserId) continue;
      await enqueueMessageReceivedPush({
        recipientUserId: mem.userId,
        conversationId,
        messageId,
        fromName,
        body: pushBody,
        messageType: pushType,
        emoji: reaction?.emoji ?? "",
        senderUserId,
        createdAt: extra.createdAt ?? "",
        transferId: extra.transferId ?? "",
        amountFcfa: extra.amountFcfa ?? 0,
        expiresAt: extra.expiresAt ?? "",
      });
    }
  } catch (err) {
    console.warn("[messaging] push notify failed", err?.message ?? err);
  }
}

/** Push envoyeur — titre = nom du destinataire, corps « a récupéré l'argent ». */
async function notifyMoneyClaimedPush(
  transfer,
  claimedByFirstName,
  claimedAt,
  claimedByName,
) {
  try {
    const fromUserId = String(transfer?.fromUserId ?? "").trim();
    const conversationId = String(transfer?.conversationId ?? "").trim();
    const transferId = String(transfer?.transferId ?? "").trim();
    const amountFcfa = Math.floor(Number(transfer?.amountFcfa) || 0);
    if (!fromUserId || !conversationId || !transferId) return;
    const { enqueueMoneyClaimedPush } = await import("./pushQueue.mjs");
    await enqueueMoneyClaimedPush({
      recipientUserId: fromUserId,
      conversationId,
      transferId,
      claimedByFirstName,
      claimedByName,
      claimedAt,
      amountFcfa,
    });
  } catch (err) {
    console.warn("[messaging] money claimed push failed", err?.message ?? err);
  }
}

async function updateInboxes(
  conversationId,
  preview,
  messageType,
  now,
  senderUserId,
) {
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
    const fromSelf = Boolean(
      senderUserId && mem.userId === senderUserId,
    );
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: userPk(mem.userId), SK: inboxSk(conversationId) },
        UpdateExpression:
          "SET updatedAt = :now, lastMessagePreview = :p, lastMessageType = :t, lastMessageAt = :now, lastMessageFromSelf = :self",
        ExpressionAttributeValues: {
          ":now": now,
          ":p": preview,
          ":t": messageType,
          ":self": fromSelf,
        },
      }),
    );
  }
}

async function updateInboxesForReaction(conversationId, fromUserId, emoji, now) {
  const profile = await getUserProfile(fromUserId);
  const firstName = String(profile?.firstName ?? "").trim().slice(0, 32);
  const selfPreview = `*\t${emoji}`;
  const peerPreview = `${firstName}\t${emoji}`;
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
        ":p": peerPreview,
        ":t": "reaction",
      },
    }),
  );

  for (const mem of members.Items ?? []) {
    if (!mem.userId) continue;
    const preview = mem.userId === fromUserId ? selfPreview : peerPreview;
    const fromSelf = mem.userId === fromUserId;
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: userPk(mem.userId), SK: inboxSk(conversationId) },
        UpdateExpression:
          "SET updatedAt = :now, lastMessagePreview = :p, lastMessageType = :t, lastMessageAt = :now, lastMessageFromSelf = :self",
        ExpressionAttributeValues: {
          ":now": now,
          ":p": preview,
          ":t": "reaction",
          ":self": fromSelf,
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
  replyToMessageId,
) {
  const text = String(body ?? "").trim();
  if (!text || text.length > 2000) return { error: "BODY_INVALID" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const replyResolved = await resolveReplyFields(conversationId, replyToMessageId);
  if (replyResolved.error) return { error: replyResolved.error };
  const replyFields = replyResolved.replyFields ?? {};

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
        ...replyFields,
      },
    }),
  );

  const reaction = parseReactionSyncBody(text);
  if (reaction) {
    if (reaction.emoji) {
      await updateInboxesForReaction(conversationId, userId, reaction.emoji, now);
      await notifyMessagePush(conversationId, userId, messageId, text);
    }
  } else {
    const preview = text.length > 80 ? `${text.slice(0, 77)}…` : text;
    await updateInboxes(conversationId, preview, "text", now, userId);
    await notifyMessagePush(conversationId, userId, messageId, preview, "text", {
      createdAt: now,
    });
    queueUnregisteredPeerInvite(conversationId, userId, "text");
  }

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
      ...replyFields,
    }),
  };
}

export async function sendVoiceMessage(
  userId,
  conversationId,
  voiceKey,
  durationMs,
  clientId,
  replyToMessageId,
) {
  const { isOwnedVoiceKey, clampVoiceDurationMs } = await import("./media.mjs");
  const key = String(voiceKey ?? "").trim();
  const dur = clampVoiceDurationMs(durationMs);
  if (!dur || !isOwnedVoiceKey(key, conversationId, userId)) {
    return { error: "VOICE_INVALID" };
  }

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const replyResolved = await resolveReplyFields(conversationId, replyToMessageId);
  if (replyResolved.error) return { error: replyResolved.error };
  const replyFields = replyResolved.replyFields ?? {};

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
        type: "voice",
        body: null,
        voiceKey: key,
        voiceDurationMs: dur,
        createdAt: now,
        clientId: clientId || null,
        ...replyFields,
      },
    }),
  );

  const preview = "VOICE";
  await updateInboxes(conversationId, preview, "voice", now, userId);
  await notifyMessagePush(
    conversationId,
    userId,
    messageId,
    "🎤 Message vocal",
    "voice",
    { createdAt: now },
  );
  queueUnregisteredPeerInvite(conversationId, userId, "voice");

  return {
    message: messagePublic({
      messageId,
      conversationId,
      senderUserId: userId,
      type: "voice",
      body: null,
      voiceKey: key,
      voiceDurationMs: dur,
      createdAt: now,
      clientId: clientId || null,
      moneyTransfer: null,
      ...replyFields,
    }),
  };
}

export async function sendImageMessage(
  userId,
  conversationId,
  imageKey,
  width,
  height,
  clientId,
  caption,
  replyToMessageId,
) {
  const { isOwnedImageKey, clampImageDimensions } = await import("./media.mjs");
  const key = String(imageKey ?? "").trim();
  const dims = clampImageDimensions(width, height);
  if (!isOwnedImageKey(key, conversationId, userId)) {
    return { error: "IMAGE_INVALID" };
  }
  const text = String(caption ?? "").trim();
  if (text.length > 2000) return { error: "BODY_INVALID" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const replyResolved = await resolveReplyFields(conversationId, replyToMessageId);
  if (replyResolved.error) return { error: replyResolved.error };
  const replyFields = replyResolved.replyFields ?? {};

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
        type: "image",
        body: text || null,
        imageKey: key,
        imageWidth: dims.width,
        imageHeight: dims.height,
        createdAt: now,
        clientId: clientId || null,
        ...replyFields,
      },
    }),
  );

  const preview = text
    ? text.length > 80
      ? `${text.slice(0, 77)}…`
      : text
    : "📷";
  await updateInboxes(conversationId, preview, "image", now, userId);
  const pushBody = text ? `📷 ${text}` : "📷 Photo";
  await notifyMessagePush(
    conversationId,
    userId,
    messageId,
    pushBody,
    "image",
    { createdAt: now },
  );
  queueUnregisteredPeerInvite(conversationId, userId, "image");

  return {
    message: messagePublic({
      messageId,
      conversationId,
      senderUserId: userId,
      type: "image",
      body: text || null,
      imageKey: key,
      imageWidth: dims.width,
      imageHeight: dims.height,
      createdAt: now,
      clientId: clientId || null,
      moneyTransfer: null,
      ...replyFields,
    }),
  };
}

export async function sendDocumentMessage(
  userId,
  conversationId,
  documentKey,
  fileName,
  sizeBytes,
  contentType,
  clientId,
  replyToMessageId,
  documentThumbKey,
  pageCount,
  caption,
) {
  const {
    isOwnedDocumentKey,
    isOwnedDocumentThumbKey,
    sanitizeDocumentFileName,
    clampDocumentSizeBytes,
    clampDocumentPageCount,
  } = await import("./media.mjs");
  const key = String(documentKey ?? "").trim();
  const name = sanitizeDocumentFileName(fileName);
  const size = clampDocumentSizeBytes(sizeBytes);
  if (!isOwnedDocumentKey(key, conversationId, userId) || size <= 0) {
    return { error: "DOCUMENT_INVALID" };
  }
  const thumbKey = String(documentThumbKey ?? "").trim();
  if (thumbKey && !isOwnedDocumentThumbKey(thumbKey, conversationId, userId)) {
    return { error: "DOCUMENT_INVALID" };
  }
  const pages = clampDocumentPageCount(pageCount);
  const text = String(caption ?? "").trim();
  if (text.length > 2000) return { error: "BODY_INVALID" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const replyResolved = await resolveReplyFields(conversationId, replyToMessageId);
  if (replyResolved.error) return { error: replyResolved.error };
  const replyFields = replyResolved.replyFields ?? {};

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const messageId = randomUUID();
  const ct = String(contentType ?? "").trim() || "application/octet-stream";

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
        type: "document",
        body: text || null,
        documentKey: key,
        documentFileName: name,
        documentSizeBytes: size,
        documentContentType: ct,
        documentThumbKey: thumbKey || null,
        documentPageCount: pages > 0 ? pages : null,
        createdAt: now,
        clientId: clientId || null,
        ...replyFields,
      },
    }),
  );

  const preview = text
    ? text.length > 80
      ? `${text.slice(0, 77)}…`
      : text
    : name.length > 72
      ? `📄 ${name.slice(0, 69)}…`
      : `📄 ${name}`;
  const pushBody = text ? `📄 ${text}` : preview;
  await updateInboxes(conversationId, preview, "document", now, userId);
  await notifyMessagePush(
    conversationId,
    userId,
    messageId,
    pushBody,
    "document",
    {
      createdAt: now,
      documentThumbKey: thumbKey || null,
      documentPageCount: pages > 0 ? pages : null,
    },
  );
  queueUnregisteredPeerInvite(conversationId, userId, "document");

  return {
    message: messagePublic({
      messageId,
      conversationId,
      senderUserId: userId,
      type: "document",
      body: text || null,
      documentKey: key,
      documentFileName: name,
      documentSizeBytes: size,
      documentContentType: ct,
      documentThumbKey: thumbKey || null,
      documentPageCount: pages > 0 ? pages : null,
      createdAt: now,
      clientId: clientId || null,
      moneyTransfer: null,
      ...replyFields,
    }),
  };
}

export async function sendMoneyMessage(
  userId,
  conversationId,
  amount,
  clientId,
  idempotencyKey,
  replyToMessageId,
  caption,
) {
  if (!isValidTxAmount(amount)) return { error: "AMOUNT_INVALID" };
  const text = String(caption ?? "").trim();
  if (text.length > 2000) return { error: "BODY_INVALID" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };

  const replyResolved = await resolveReplyFields(conversationId, replyToMessageId);
  if (replyResolved.error) return { error: replyResolved.error };
  const replyFields = replyResolved.replyFields ?? {};

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
  const preview = text
    ? text.length > 80
      ? `${text.slice(0, 77)}…`
      : text
    : `💰 ${amount.toLocaleString("fr-FR")} FCFA`;

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
    body: text || null,
    createdAt: now,
    clientId: clientId || null,
    ...replyFields,
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

  await updateInboxes(conversationId, preview, "money", now, userId);
  await notifyMessagePush(conversationId, userId, messageId, preview, "money", {
    createdAt: now,
    transferId,
    amountFcfa: amount,
    expiresAt,
  });
  queueUnregisteredPeerInvite(conversationId, userId, "money", {
    amountFcfa: amount,
  });
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
    const refreshed = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { PK: mtPk(transferId), SK: "META" },
      }),
    );
    const pub = transferPublic(refreshed.Item ?? { ...t, status: "expired" });
    void notifyMoneyUpdatedPush(pub);
    return { error: "EXPIRED", transfer: pub };
  }

  const claimer = await getUserProfile(claimerUserId);
  if (!claimer) return { error: "USER_NOT_FOUND" };
  const sender = await getUserProfile(t.fromUserId);
  const senderName = displayNameFromProfile(sender, sender?.phone);

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
          "SET #st = :claimed, claimedAt = :now, claimedByUserId = :uid, toUserId = :uid, claimedByFirstName = :fn",
        ConditionExpression: "#st = :pending",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":claimed": "claimed",
          ":pending": "pending",
          ":now": now,
          ":uid": claimerUserId,
          ":fn": String(claimer.firstName ?? "").trim().slice(0, 32) || null,
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
          counterpartyName: senderName,
          counterpartyPhone: sender?.phone ?? null,
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
  const claimedByFirstName =
    String(claimer.firstName ?? "").trim().slice(0, 32);
  await notifyMoneyClaimedPush(
    updated.Item ?? t,
    claimedByFirstName,
    now,
    senderLabel(claimer),
  );
  return { transfer: transferPublic(updated.Item), balanceFcfa, reused: false };
}

async function loadMoneyTransferPublic(transferId, { notifyOnExpire = false } = {}) {
  const id = String(transferId ?? "").trim();
  if (!id) return null;
  const tRes = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(id), SK: "META" },
    }),
  );
  let t = tRes.Item;
  if (!t) return null;
  if (
    t.status === "pending" &&
    t.expiresAt &&
    Date.parse(t.expiresAt) <= Date.now()
  ) {
    const { ok } = await expireMoneyTransfer(id);
    if (ok) {
      const again = await doc.send(
        new GetCommand({
          TableName: getTableName(),
          Key: { PK: mtPk(id), SK: "META" },
        }),
      );
      t = again.Item ?? { ...t, status: "expired" };
      if (notifyOnExpire) {
        void notifyMoneyUpdatedPush(transferPublic(t));
      }
    }
  }
  return transferPublic(t);
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

async function refundPendingToSender(t, status, extraUpdate, txType, counterpartyName) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const names = { "#st": "status", ...(extraUpdate?.names ?? {}) };
  const values = {
    ":st": status,
    ":pending": "pending",
    ":now": now,
    ...(extraUpdate?.values ?? {}),
  };
  const extraSet = extraUpdate?.set ? `, ${extraUpdate.set}` : "";
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: getTableName(),
              Key: { PK: mtPk(t.transferId), SK: "META" },
              UpdateExpression: `SET #st = :st, settledAt = :now${extraSet}`,
              ConditionExpression: "#st = :pending",
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
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
                SK: `TX#${String(nowMs).padStart(13, "0")}#${status}${t.transferId}`,
                transactionId: `${status}-${t.transferId}`,
                userId: t.fromUserId,
                type: txType,
                amountFcfa: t.amountFcfa,
                counterpartyName,
                counterpartyPhone: t.toPhone,
                createdAt: now,
              },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      return { error: "CONFLICT" };
    }
    throw err;
  }
  const updated = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(t.transferId), SK: "META" },
    }),
  );
  return {
    transfer: transferPublic(updated.Item ?? t),
    balanceFcfa: await getUserBalance(t.fromUserId),
  };
}

async function loadPendingTransfer(transferId) {
  const tRes = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(transferId), SK: "META" },
    }),
  );
  const t = tRes.Item;
  if (!t) return { error: "NOT_FOUND" };
  if (t.status !== "pending") {
    return { error: "NOT_PENDING", transfer: transferPublic(t) };
  }
  if (Date.parse(t.expiresAt) <= Date.now()) {
    await expireMoneyTransfer(transferId);
    const refreshed = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { PK: mtPk(transferId), SK: "META" },
      }),
    );
    const pub = transferPublic(refreshed.Item ?? { ...t, status: "expired" });
    void notifyMoneyUpdatedPush(pub);
    return { error: "EXPIRED", transfer: pub };
  }
  return { t };
}

function isMoneyRecipient(t, userId, phone) {
  if (t.toUserId && t.toUserId === userId) return true;
  if (!t.toUserId && phone && t.toPhone === phone) return true;
  return false;
}

export async function recallMoneyTransfer(userId, transferId) {
  const loaded = await loadPendingTransfer(transferId);
  if (loaded.error) return loaded;
  const { t } = loaded;
  if (t.fromUserId !== userId) return { error: "FORBIDDEN" };
  const profile = await getUserProfile(userId);
  const fn = String(profile?.firstName ?? "").trim().slice(0, 32) || null;
  const result = await refundPendingToSender(
    t,
    "claimed",
    {
      set: "claimedAt = :now, claimedByUserId = :uid, claimedByFirstName = :fn",
      names: {},
      values: { ":uid": userId, ":fn": fn },
    },
    "MONEY_RECALL",
    "Message Money (annulé)",
  );
  if (result.error) return result;
  await notifyMoneyUpdatedPush(result.transfer, userId);
  return result;
}

export async function thankMoneyTransfer(userId, transferId) {
  const tRes = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(transferId), SK: "META" },
    }),
  );
  const t = tRes.Item;
  if (!t) return { error: "NOT_FOUND" };
  const profile = await getUserProfile(userId);
  if (!profile) return { error: "USER_NOT_FOUND" };
  if (!isMoneyRecipient(t, userId, profile.phone)) return { error: "FORBIDDEN" };
  if (t.fromUserId === userId) return { error: "SELF" };
  if (t.thanksUserId) {
    return { ok: true, transfer: transferPublic(t), reused: true };
  }
  const fn = String(profile.firstName ?? "").trim().slice(0, 32) || "Quelqu’un";
  const now = new Date().toISOString();
  try {
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: mtPk(transferId), SK: "META" },
        UpdateExpression:
          "SET thanksUserId = :uid, thanksFirstName = :fn, thanksAt = :now",
        ConditionExpression: "attribute_not_exists(thanksUserId)",
        ExpressionAttributeValues: {
          ":uid": userId,
          ":fn": fn,
          ":now": now,
        },
      }),
    );
  } catch (err) {
    if (err?.name !== "ConditionalCheckFailedException") throw err;
  }
  const updated = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: mtPk(transferId), SK: "META" },
    }),
  );
  const transfer = transferPublic(updated.Item ?? t);
  await notifyMoneyUpdatedPush(transfer, userId);
  await notifyMoneyTrayPush(transfer, t.fromUserId, "money_thanks", {
    fromName: senderLabel(profile),
    thanksFirstName: fn,
  });
  return { ok: true, transfer };
}

export async function markConversationTyping(userId, conversationId, on) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { error: "FORBIDDEN" };
  const profile = await getUserProfile(userId);
  const fromName =
    String(profile?.firstName ?? "").trim() ||
    senderLabel(profile).split(/\s+/)[0] ||
    "Blyp";
  try {
    const { enqueueConversationTypingPush } = await import("./pushQueue.mjs");
    const members = await listConvMembers(conversationId);
    for (const mem of members) {
      if (!mem.userId || mem.userId === userId) continue;
      await enqueueConversationTypingPush({
        recipientUserId: mem.userId,
        conversationId,
        fromName,
        on: Boolean(on),
      });
    }
  } catch (err) {
    console.warn("[messaging] typing push failed", err?.message ?? err);
  }
  return { ok: true };
}

async function notifyMoneyUpdatedPush(transfer, actorUserId) {
  const conversationId = String(transfer?.conversationId ?? "").trim();
  const transferId = String(transfer?.transferId ?? "").trim();
  if (!conversationId || !transferId) return;
  try {
    const { enqueueMoneyUpdatedPush } = await import("./pushQueue.mjs");
    const members = await listConvMembers(conversationId);
    const actor = actorUserId ? String(actorUserId).trim() : "";
    for (const mem of members) {
      if (!mem.userId || (actor && mem.userId === actor)) continue;
      await enqueueMoneyUpdatedPush({
        recipientUserId: mem.userId,
        conversationId,
        transferId,
        status: transfer.status,
        claimedByFirstName: transfer.claimedByFirstName ?? "",
        claimedByUserId: transfer.claimedByUserId ?? "",
        thanksFirstName: transfer.thanksFirstName ?? "",
        thanksUserId: transfer.thanksUserId ?? "",
      });
    }
  } catch (err) {
    console.warn("[messaging] money update push failed", err?.message ?? err);
  }
}

async function notifyMoneyTrayPush(transfer, recipientUserId, type, extra) {
  const to = String(recipientUserId ?? "").trim();
  const conversationId = String(transfer?.conversationId ?? "").trim();
  const transferId = String(transfer?.transferId ?? "").trim();
  if (!to || !conversationId || !transferId) return;
  try {
    const { enqueueMoneyTrayPush } = await import("./pushQueue.mjs");
    await enqueueMoneyTrayPush({
      type,
      recipientUserId: to,
      conversationId,
      transferId,
      fromName: extra?.fromName ?? "",
      claimedByFirstName: extra?.claimedByFirstName ?? extra?.fromName ?? "",
      claimedByName: extra?.claimedByName ?? extra?.fromName ?? "",
      thanksFirstName: extra?.thanksFirstName ?? "",
      amountFcfa: transfer.amountFcfa,
    });
  } catch (err) {
    console.warn("[messaging] money tray push failed", err?.message ?? err);
  }
}

/** Quels numéros (E.164) ont un compte Blyp — liste « nouveau message ». */
export async function lookupPhonesOnBlyp(phoneList) {
  const seen = new Set();
  const items = [];
  for (const raw of phoneList ?? []) {
    const e164 = normalizePeerPhoneE164(raw);
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    if (seen.size > 300) break;
    const userId = await getUserIdByPhone(e164);
    items.push({ phone: e164, onBlyp: Boolean(userId) });
  }
  return { items };
}
