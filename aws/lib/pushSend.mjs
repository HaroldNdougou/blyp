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
  const isCommerce = msg?.contextType === "commerce";
  const title = isCommerce ? "Paiement reçu" : "Transfert reçu";

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
      title,
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
  const messageType = String(msg?.messageType ?? "").trim() || "text";
  const emoji = String(msg?.emoji ?? "").trim();
  const senderUserId = String(msg?.senderUserId ?? "").trim();
  const createdAt = String(msg?.createdAt ?? "").trim();
  const transferId = String(msg?.transferId ?? "").trim();
  const amountFcfa = Math.floor(Number(msg?.amountFcfa) || 0);
  const expiresAt = String(msg?.expiresAt ?? "").trim();
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
      messageType,
      emoji,
      senderUserId,
      createdAt,
      transferId,
      amountFcfa: String(amountFcfa),
      expiresAt,
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

/**
 * Notif envoyeur — titre = nom (comme une réaction), corps « a récupéré l'argent ».
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   transferId: string,
 *   claimedByFirstName: string,
 *   claimedByName?: string,
 *   claimedAt?: string | null,
 *   amountFcfa?: number,
 * }} msg
 */
export async function sendMoneyClaimedPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const transferId = String(msg?.transferId ?? "").trim();
  const claimedByFirstName = String(msg?.claimedByFirstName ?? "")
    .trim()
    .slice(0, 32);
  const claimedByName = String(msg?.claimedByName ?? claimedByFirstName)
    .trim()
    .slice(0, 64);
  const amountFcfa = Math.floor(Number(msg?.amountFcfa) || 0);
  if (!recipientUserId || !conversationId || !transferId) {
    return { skipped: true, reason: "INVALID" };
  }

  const claimed = await claimPushOnce(`money_claimed:${transferId}`);
  if (!claimed) return { skipped: true, reason: "ALREADY_SENT" };

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const claimedAt =
    String(msg?.claimedAt ?? "").trim() || new Date().toISOString();
  const fromName = claimedByName || claimedByFirstName || "Blyp";
  const body = "a récupéré l'argent";

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "money_claimed",
      conversationId,
      transferId,
      claimedByFirstName,
      claimedByName,
      claimedAt,
      amountFcfa: String(amountFcfa),
      fromName,
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
      console.warn(
        "[push] money claimed ticket error",
        t.message,
        t.details?.error,
      );
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

/**
 * Notif tray — merci (même forme que money_claimed / réaction).
 */
export async function sendMoneyTrayPush(msg) {
  const type = String(msg?.type ?? "").trim();
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const transferId = String(msg?.transferId ?? "").trim();
  if (
    type !== "money_thanks" ||
    !recipientUserId ||
    !conversationId ||
    !transferId
  ) {
    return { skipped: true, reason: "INVALID" };
  }

  const claimed = await claimPushOnce(`${type}:${transferId}`);
  if (!claimed) return { skipped: true, reason: "ALREADY_SENT" };

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const fromName =
    String(msg?.fromName ?? "").trim() ||
    String(msg?.thanksFirstName ?? "").trim() ||
    String(msg?.claimedByName ?? "").trim() ||
    String(msg?.claimedByFirstName ?? "").trim() ||
    "Blyp";
  const body = "a dit merci";

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type,
      conversationId,
      transferId,
      fromName,
      title: fromName,
      message: body,
      claimedByFirstName: String(msg?.claimedByFirstName ?? fromName).trim(),
      claimedByName: fromName,
      thanksFirstName: String(msg?.thanksFirstName ?? "").trim(),
      amountFcfa: String(Math.floor(Number(msg?.amountFcfa) || 0)),
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
      console.warn("[push] money tray ticket error", t.message, t.details?.error);
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

/**
 * Data-only — ticks WhatsApp (lu / reçu).
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   kind: "read" | "delivered",
 *   at: string,
 * }} msg
 */
export async function sendConversationReceiptPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const kind = msg?.kind === "read" ? "read" : "delivered";
  const at = String(msg?.at ?? "").trim();
  if (!recipientUserId || !conversationId || !at) {
    return { skipped: true, reason: "INVALID" };
  }

  const claimed = await claimPushOnce(`receipt:${kind}:${conversationId}:${at}`);
  if (!claimed) return { skipped: true, reason: "ALREADY_SENT" };

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "conversation_receipt",
      conversationId,
      kind,
      at,
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
      console.warn("[push] receipt ticket error", t.message, t.details?.error);
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

/**
 * Data-only — réaction sur un message.
 */
export async function sendMessageReactionPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const messageId = String(msg?.messageId ?? "").trim();
  const reactions = Array.isArray(msg?.reactions) ? msg.reactions : [];
  if (!recipientUserId || !conversationId || !messageId) {
    return { skipped: true, reason: "INVALID" };
  }

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "message_reaction",
      conversationId,
      messageId,
      reactions: JSON.stringify(reactions),
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
      console.warn("[push] reaction ticket error", t.message, t.details?.error);
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

export async function sendMessageDeletedPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const messageId = String(msg?.messageId ?? "").trim();
  const deletedForAll = msg?.deletedForAll !== false;
  if (!recipientUserId || !conversationId || !messageId) {
    return { skipped: true, reason: "INVALID" };
  }

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "message_deleted",
      conversationId,
      messageId,
      deletedForAll: deletedForAll ? "1" : "0",
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
      console.warn("[push] delete ticket error", t.message, t.details?.error);
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

/**
 * Data-only — indicateur « écrit… ».
 * @param {{
 *   recipientUserId: string,
 *   conversationId: string,
 *   fromName: string,
 *   on?: boolean | string,
 * }} msg
 */
export async function sendConversationTypingPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const fromName = String(msg?.fromName ?? "").trim() || "Blyp";
  const on = msg?.on === false || msg?.on === "0" ? "0" : "1";
  if (!recipientUserId || !conversationId) {
    return { skipped: true, reason: "INVALID" };
  }

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "conversation_typing",
      conversationId,
      fromName,
      on,
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
      console.warn("[push] typing ticket error", t.message, t.details?.error);
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

/**
 * Data-only — statut message money (rappel / merci).
 */
export async function sendMoneyUpdatedPush(msg) {
  const recipientUserId = String(msg?.recipientUserId ?? "").trim();
  const conversationId = String(msg?.conversationId ?? "").trim();
  const transferId = String(msg?.transferId ?? "").trim();
  if (!recipientUserId || !conversationId || !transferId) {
    return { skipped: true, reason: "INVALID" };
  }

  const devices = await listDeviceTokens(recipientUserId);
  if (!devices.length) return { skipped: true, reason: "NO_DEVICES" };

  const messages = devices.map((d) => ({
    to: d.token,
    priority: "high",
    _contentAvailable: true,
    data: {
      type: "money_updated",
      conversationId,
      transferId,
      status: String(msg?.status ?? "").trim(),
      claimedByFirstName: String(msg?.claimedByFirstName ?? "").trim(),
      claimedByUserId: String(msg?.claimedByUserId ?? "").trim(),
      thanksFirstName: String(msg?.thanksFirstName ?? "").trim(),
      thanksUserId: String(msg?.thanksUserId ?? "").trim(),
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
      console.warn("[push] money updated ticket error", t.message, t.details?.error);
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
