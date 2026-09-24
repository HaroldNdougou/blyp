import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";
import { deleteDeviceTokenByValue, listDeviceTokens } from "./devices.mjs";

const doc = getDocClient();
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * @param {number} amount
 */
function formatAmountFr(amount) {
  return Math.max(0, Math.floor(amount)).toLocaleString("fr-FR");
}

/**
 * Idempotence push : 1 envoi max par transactionId (TTL 7 j).
 * @param {string} transactionId
 * @returns {Promise<boolean>} true si on peut envoyer
 */
async function claimPushOnce(transactionId) {
  try {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: "IDEM#push",
          SK: String(transactionId),
          createdAt: new Date().toISOString(),
          expiresAt: ttlFromNowMs(7 * 24 * 60 * 60 * 1000),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/**
 * @param {{
 *   recipientUserId: string,
 *   transactionId: string,
 *   amountFcfa: number,
 *   fromName: string,
 *   contextType: "personal" | "commerce",
 *   commerceId?: string | null,
 * }} msg
 */
export async function sendPaymentReceivedPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const transactionId = String(msg?.transactionId ?? "").trim();
  const amountFcfa = Math.floor(Number(msg?.amountFcfa) || 0);
  if (!recipientUserId || !transactionId || amountFcfa <= 0) {
    return { skipped: true, reason: "INVALID" };
  }

  const claimed = await claimPushOnce(transactionId);
  if (!claimed) return { skipped: true, reason: "ALREADY_SENT" };

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const fromName = String(msg?.fromName ?? "").trim() || "Blyp";
  const amountLabel = formatAmountFr(amountFcfa);
  const body = `${amountLabel}F reçus de ${fromName}`;

  const data = {
    type: "payment_received",
    transactionId,
    amountFcfa: String(amountFcfa),
    fromName,
    contextType: msg?.contextType === "commerce" ? "commerce" : "personal",
    commerceId: msg?.commerceId != null ? String(msg.commerceId) : "",
  };

  /** Data-only : onMessageReceived Android même en arrière-plan (annonce vocale native). */
  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      ...data,
      title: "Paiement reçu",
      message: body,
      sound: "default",
      channelId: "payments",
    },
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => null);
  const tickets = json?.data ?? [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const device = devices[i];
    if (t?.status === "error") {
      console.warn(
        "[push] ticket error",
        t.message,
        t.details?.error,
        device?.deviceId ?? device?.token?.slice(0, 24),
      );
      const err = String(t.details?.error ?? t.details?.fault ?? "");
      if (err.includes("DeviceNotRegistered") && device?.token) {
        await deleteDeviceTokenByValue(recipientUserId, device.token).catch(
          () => {},
        );
      }
    }
  }
  return { ok: true, tickets, count: messages.length };
}

/**
 * Notification visible (title/body) — le chat ouvert se met à jour via le data.
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   messageId: string,
 *   fromName: string,
 *   body: string,
 * }} msg
 */
export async function sendMessageReceivedPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const messageId = String(msg?.messageId ?? "").trim();
  const body = String(msg?.body ?? "").trim();
  const fromName = String(msg?.fromName ?? "").trim() || "Blyp";
  if (!recipientUserId || !conversationId || !messageId || !body) {
    return { skipped: true, reason: "INVALID" };
  }

  const claimed = await claimPushOnce(messageId);
  if (!claimed) return { skipped: true, reason: "ALREADY_SENT" };

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  /** Data-only : onMessageReceived Android (MIUI ignore souvent title/body Expo). */
  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "message_received",
      conversationId,
      messageId,
      fromName,
      body,
      title: fromName,
      message: body,
      sound: "default",
      channelId: "messages",
    },
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => null);
  const tickets = json?.data ?? [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const device = devices[i];
    if (t?.status === "error") {
      console.warn("[push] message ticket error", t.message, t.details?.error);
      const err = String(t.details?.error ?? "");
      if (err.includes("DeviceNotRegistered") && device?.token) {
        await deleteDeviceTokenByValue(recipientUserId, device.token).catch(
          () => {},
        );
      }
    }
  }
  return { ok: true, tickets, count: messages.length };
}
