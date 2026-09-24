import {
  sendMessageReceivedPush,
  sendPaymentReceivedPush,
} from "../../lib/pushSend.mjs";

/**
 * Worker SQS — envoi push Expo (paiement reçu).
 * Jamais sur le chemin HTTP critique.
 */
export async function handler(event) {
  const records = event?.Records ?? [];
  const failures = [];

  for (const record of records) {
    try {
      const msg = JSON.parse(record.body ?? "{}");
      if (msg?.type === "message_received") {
        const result = await sendMessageReceivedPush(msg);
        if (result?.skipped) {
          console.log("[push] message skipped", result.reason, msg.messageId);
        } else {
          console.log("[push] message sent", msg.messageId, result?.count);
        }
        continue;
      }
      if (msg?.type !== "payment_received") {
        console.warn("[push] unknown type", msg?.type);
        continue;
      }
      const result = await sendPaymentReceivedPush(msg);
      if (result?.skipped) {
        console.log("[push] skipped", result.reason, msg.transactionId);
      } else {
        console.log("[push] sent", msg.transactionId, result?.count);
      }
    } catch (err) {
      console.error("[push] fail", record?.messageId, err);
      if (record?.messageId) failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
