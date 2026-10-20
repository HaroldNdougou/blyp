import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

/**
 * Enfile un push « paiement reçu » (best-effort, hors chemin critique HTTP).
 * @param {{
 *   recipientUserId: string,
 *   transactionId: string,
 *   amountFcfa: number,
 *   fromName: string,
 *   contextType: "personal" | "commerce",
 *   commerceId?: string | null,
 * }} payload
 */
export async function enqueuePaymentReceivedPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };

  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const transactionId = String(payload?.transactionId ?? "").trim();
  const amountFcfa = Math.floor(Number(payload?.amountFcfa) || 0);
  if (!recipientUserId || !transactionId || amountFcfa <= 0) {
    return { skipped: true, reason: "INVALID" };
  }

  const body = {
    type: "payment_received",
    recipientUserId,
    transactionId,
    amountFcfa,
    fromName: String(payload?.fromName ?? "").trim() || "Blyp",
    contextType:
      payload?.contextType === "commerce" ? "commerce" : "personal",
    commerceId:
      payload?.commerceId != null ? String(payload.commerceId) : null,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(body),
      MessageAttributes: {
        type: {
          DataType: "String",
          StringValue: "payment_received",
        },
      },
    }),
  );

  return { ok: true };
}

/**
 * Enfile un push « nouveau message » (best-effort).
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   messageId: string,
 *   fromName: string,
 *   body: string,
 *   messageType?: string,
 *   emoji?: string,
 * }} payload
 */
export async function enqueueMessageReceivedPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };

  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const messageId = String(payload?.messageId ?? "").trim();
  const body = String(payload?.body ?? "").trim();
  if (!recipientUserId || !conversationId || !messageId || !body) {
    return { skipped: true, reason: "INVALID" };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "message_received",
        recipientUserId,
        conversationId,
        messageId,
        fromName: String(payload?.fromName ?? "").trim() || "Blyp",
        body,
        messageType: String(payload?.messageType ?? "").trim() || "text",
        emoji: String(payload?.emoji ?? "").trim(),
        senderUserId: String(payload?.senderUserId ?? "").trim(),
        createdAt: String(payload?.createdAt ?? "").trim(),
        transferId: String(payload?.transferId ?? "").trim(),
        amountFcfa: Math.floor(Number(payload?.amountFcfa) || 0),
        expiresAt: String(payload?.expiresAt ?? "").trim(),
        ...(payload?.receiptRequired
          ? { receiptRequired: "1" }
          : {}),
      }),
    }),
  );

  return { ok: true };
}

/**
 * Enfile un push « argent récupéré » vers l’envoyeur (notif tray + deep link).
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   transferId: string,
 *   claimedByFirstName: string,
 *   claimedByName?: string,
 *   claimedAt?: string,
 *   amountFcfa?: number,
 * }} payload
 */
export async function enqueueMoneyClaimedPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };

  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const transferId = String(payload?.transferId ?? "").trim();
  const claimedByFirstName = String(payload?.claimedByFirstName ?? "")
    .trim()
    .slice(0, 32);
  const claimedByName = String(payload?.claimedByName ?? claimedByFirstName)
    .trim()
    .slice(0, 64);
  const amountFcfa = Math.floor(Number(payload?.amountFcfa) || 0);
  if (!recipientUserId || !conversationId || !transferId) {
    return { skipped: true, reason: "INVALID" };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "money_claimed",
        recipientUserId,
        conversationId,
        transferId,
        claimedByFirstName,
        claimedByName,
        claimedAt: String(payload?.claimedAt ?? "").trim() || null,
        amountFcfa,
      }),
    }),
  );

  return { ok: true };
}

/**
 * Accusé lu / reçu — data-only, pas de notif.
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   kind: "read" | "delivered",
 *   at: string,
 * }} payload
 */
export async function enqueueConversationReceiptPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };

  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const kind = payload?.kind === "read" ? "read" : "delivered";
  const at = String(payload?.at ?? "").trim();
  if (!recipientUserId || !conversationId || !at) {
    return { skipped: true, reason: "INVALID" };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "conversation_receipt",
        recipientUserId,
        conversationId,
        kind,
        at,
      }),
    }),
  );

  return { ok: true };
}

/**
 * Réaction — data-only, pas de notif.
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   messageId: string,
 *   reactions: { userId: string, emoji: string }[],
 * }} payload
 */
export async function enqueueMessageReactionPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };

  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const messageId = String(payload?.messageId ?? "").trim();
  const reactions = Array.isArray(payload?.reactions) ? payload.reactions : [];
  if (!recipientUserId || !conversationId || !messageId) {
    return { skipped: true, reason: "INVALID" };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "message_reaction",
        recipientUserId,
        conversationId,
        messageId,
        reactions,
      }),
    }),
  );

  return { ok: true };
}

/**
 * Message supprimé — data-only (sync fil).
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   messageId: string,
 *   deletedForAll: boolean,
 * }} payload
 */
export async function enqueueMessageDeletedPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };

  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const messageId = String(payload?.messageId ?? "").trim();
  const deletedForAll = Boolean(payload?.deletedForAll);
  if (!recipientUserId || !conversationId || !messageId) {
    return { skipped: true, reason: "INVALID" };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "message_deleted",
        recipientUserId,
        conversationId,
        messageId,
        deletedForAll,
      }),
    }),
  );

  return { ok: true };
}

/**
 * Data-only — l’interlocuteur écrit.
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   fromName: string,
 *   on?: boolean | string,
 * }} payload
 */
/**
 * Data-only — l’interlocuteur est en ligne (heartbeat fil).
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   at: string,
 * }} payload
 */
export async function enqueueConversationPresencePush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };
  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const at = String(payload?.at ?? "").trim();
  if (!recipientUserId || !conversationId || !at) {
    return { skipped: true, reason: "INVALID" };
  }
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "conversation_presence",
        recipientUserId,
        conversationId,
        at,
      }),
    }),
  );
  return { ok: true };
}

export async function enqueueConversationTypingPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };
  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const fromName = String(payload?.fromName ?? "").trim() || "Blyp";
  if (!recipientUserId || !conversationId) {
    return { skipped: true, reason: "INVALID" };
  }
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "conversation_typing",
        recipientUserId,
        conversationId,
        fromName,
        on: payload?.on === false || payload?.on === "0" ? "0" : "1",
        ...(payload?.presenceAt
          ? { presenceAt: String(payload.presenceAt) }
          : {}),
      }),
    }),
  );
  return { ok: true };
}

/**
 * Data-only — transfert money mis à jour (rappel, merci).
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   transferId: string,
 *   status?: string,
 *   claimedByFirstName?: string,
 *   claimedByUserId?: string,
 *   thanksFirstName?: string,
 *   thanksUserId?: string,
 * }} payload
 */
export async function enqueueMoneyUpdatedPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };
  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const transferId = String(payload?.transferId ?? "").trim();
  if (!recipientUserId || !conversationId || !transferId) {
    return { skipped: true, reason: "INVALID" };
  }
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: "money_updated",
        recipientUserId,
        conversationId,
        transferId,
        status: String(payload?.status ?? "").trim(),
        claimedByFirstName: String(payload?.claimedByFirstName ?? "").trim(),
        claimedByUserId: String(payload?.claimedByUserId ?? "").trim(),
        thanksFirstName: String(payload?.thanksFirstName ?? "").trim(),
        thanksUserId: String(payload?.thanksUserId ?? "").trim(),
        ...(payload?.receiptRequired === true || payload?.receiptRequired === false
          ? {
              receiptRequired: payload.receiptRequired ? "1" : "0",
            }
          : {}),
      }),
    }),
  );
  return { ok: true };
}

/**
 * Notif tray — merci (même canal que money_claimed).
 */
export async function enqueueMoneyTrayPush(payload) {
  const queueUrl = process.env.PUSH_QUEUE_URL?.trim();
  if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };
  const recipientUserId = String(payload?.recipientUserId ?? "").trim();
  const conversationId = String(payload?.conversationId ?? "").trim();
  const transferId = String(payload?.transferId ?? "").trim();
  const type = String(payload?.type ?? "").trim();
  if (!recipientUserId || !conversationId || !transferId) {
    return { skipped: true, reason: "INVALID" };
  }
  if (type !== "money_thanks") {
    return { skipped: true, reason: "INVALID" };
  }
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type,
        recipientUserId,
        conversationId,
        transferId,
        fromName: String(payload?.fromName ?? "").trim(),
        claimedByFirstName: String(payload?.claimedByFirstName ?? "").trim(),
        claimedByName: String(payload?.claimedByName ?? "").trim(),
        thanksFirstName: String(payload?.thanksFirstName ?? "").trim(),
        amountFcfa: Math.floor(Number(payload?.amountFcfa) || 0),
      }),
    }),
  );
  return { ok: true };
}
