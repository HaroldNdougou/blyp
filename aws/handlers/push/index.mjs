import {
  sendConversationReceiptPush,
  sendConversationTypingPush,
  sendMessageReactionPush,
  sendMessageDeletedPush,
  sendMessageReceivedPush,
  sendMoneyClaimedPush,
  sendMoneyTrayPush,
  sendMoneyUpdatedPush,
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
      if (msg?.type === "money_claimed") {
        const result = await sendMoneyClaimedPush(msg);
        if (result?.skipped) {
          console.log("[push] money claimed skipped", result.reason, msg.transferId);
        } else {
          console.log("[push] money claimed sent", msg.transferId, result?.count);
        }
        continue;
      }
      if (msg?.type === "money_thanks") {
        const result = await sendMoneyTrayPush(msg);
        if (result?.skipped) {
          console.log("[push] money tray skipped", result.reason, msg.transferId);
        } else {
          console.log("[push] money tray sent", msg.type, msg.transferId, result?.count);
        }
        continue;
      }
      if (msg?.type === "conversation_receipt") {
        const result = await sendConversationReceiptPush(msg);
        if (result?.skipped) {
          console.log("[push] receipt skipped", result.reason, msg.conversationId);
        } else {
          console.log("[push] receipt sent", msg.kind, msg.conversationId);
        }
        continue;
      }
      if (msg?.type === "message_reaction") {
        const result = await sendMessageReactionPush(msg);
        if (result?.skipped) {
          console.log("[push] reaction skipped", result.reason, msg.messageId);
        } else {
          console.log("[push] reaction sent", msg.messageId, result?.count);
        }
        continue;
      }
      if (msg?.type === "message_deleted") {
        const result = await sendMessageDeletedPush(msg);
        if (result?.skipped) {
          console.log("[push] delete skipped", result.reason, msg.messageId);
        } else {
          console.log("[push] delete sent", msg.messageId, result?.count);
        }
        continue;
      }
      if (msg?.type === "conversation_typing") {
        const result = await sendConversationTypingPush(msg);
        if (result?.skipped) {
          console.log("[push] typing skipped", result.reason, msg.conversationId);
        }
        continue;
      }
      if (msg?.type === "conversation_presence") {
        const { sendConversationPresencePush } = await import(
          "../../lib/pushSend.mjs"
        );
        const result = await sendConversationPresencePush(msg);
        if (result?.skipped) {
          console.log(
            "[push] presence skipped",
            result.reason,
            msg.conversationId,
          );
        }
        continue;
      }
      if (msg?.type === "money_updated") {
        const result = await sendMoneyUpdatedPush(msg);
        if (result?.skipped) {
          console.log("[push] money updated skipped", result.reason, msg.transferId);
        } else {
          console.log("[push] money updated sent", msg.transferId, result?.count);
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
