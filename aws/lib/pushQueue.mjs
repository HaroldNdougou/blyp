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
      }),
    }),
  );

  return { ok: true };
}
