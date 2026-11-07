/**
 * Blyp realtime v1 — frames binaires (miroir de lib/realtime/blypWsFrame.ts).
 */

export const BlypWsOpcode = {
  PING: 0x01,
  PONG: 0x02,
  PAYMENT_RECEIVED: 0x10,
  CHAT_JSON: 0x20,
  CONVERSATION_PRESENCE: 0x21,
  CONVERSATION_TYPING: 0x22,
};

const HEADER_LEN = 9;
const VERSION = 1;
const FLAG_COMPACT = 1;

function u32be(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0)) >>> 0;
  return Buffer.from([
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ]);
}

function readU32be(buf, off) {
  return (
    ((buf[off] << 24) |
      (buf[off + 1] << 16) |
      (buf[off + 2] << 8) |
      buf[off + 3]) >>>
    0
  );
}

function buildHeader(opcode, payloadLen, flags) {
  const h = Buffer.alloc(HEADER_LEN);
  h[0] = 0x42;
  h[1] = 0x59;
  h[2] = VERSION;
  h[3] = flags & 0xff;
  h[4] = opcode & 0xff;
  u32be(payloadLen).copy(h, 5);
  return h;
}

export function encodePaymentReceivedCompact(payload) {
  const txId = Buffer.from(String(payload.transactionId ?? "").slice(0, 120), "utf8");
  const fromName = Buffer.from(String(payload.fromName ?? "").slice(0, 80), "utf8");
  const ctx = String(payload.contextType ?? "") === "commerce" ? 1 : 0;
  const commerceRaw = String(payload.commerceId ?? "").trim();
  const commerce =
    ctx === 1 ? Buffer.from(commerceRaw.slice(0, 64), "utf8") : Buffer.alloc(0);
  const amount = Math.max(0, Math.floor(Number(payload.amountFcfa) || 0)) >>> 0;

  const body = Buffer.alloc(
    1 + txId.length + 4 + 1 + fromName.length + 1 + 1 + commerce.length,
  );
  let o = 0;
  body[o++] = txId.length & 0xff;
  txId.copy(body, o);
  o += txId.length;
  u32be(amount).copy(body, o);
  o += 4;
  body[o++] = fromName.length & 0xff;
  fromName.copy(body, o);
  o += fromName.length;
  body[o++] = ctx & 0xff;
  body[o++] = commerce.length & 0xff;
  if (commerce.length) commerce.copy(body, o);

  return Buffer.concat([
    buildHeader(BlypWsOpcode.PAYMENT_RECEIVED, body.length, FLAG_COMPACT),
    body,
  ]);
}

function decodePaymentReceivedCompact(payload) {
  if (payload.length < 8) return null;
  let o = 0;
  const txLen = payload[o++];
  if (o + txLen + 4 > payload.length) return null;
  const txId = payload.subarray(o, o + txLen).toString("utf8");
  o += txLen;
  const amount = readU32be(payload, o);
  o += 4;
  if (o >= payload.length) return null;
  const nameLen = payload[o++];
  if (o + nameLen + 2 > payload.length) return null;
  const fromName = payload.subarray(o, o + nameLen).toString("utf8");
  o += nameLen;
  const ctx = payload[o++];
  const commerceLen = payload[o++];
  if (o + commerceLen > payload.length) return null;
  const commerceId =
    commerceLen > 0
      ? payload.subarray(o, o + commerceLen).toString("utf8")
      : null;
  return {
    type: "payment_received",
    transactionId: txId,
    amountFcfa: amount,
    fromName,
    contextType: ctx === 1 ? "commerce" : "personal",
    commerceId: commerceId || null,
  };
}

export function encodeChatJsonPayload(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  return Buffer.concat([
    buildHeader(BlypWsOpcode.CHAT_JSON, json.length, 0),
    json,
  ]);
}

function isoToUnixSec(iso) {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 1000));
}

function unixSecToIso(sec) {
  if (sec <= 0) return new Date().toISOString();
  return new Date(sec * 1000).toISOString();
}

export function encodeConversationPresenceCompact(payload) {
  const conv = Buffer.from(String(payload.conversationId ?? "").slice(0, 64), "utf8");
  const atSec = isoToUnixSec(payload.at);
  const body = Buffer.alloc(1 + conv.length + 4);
  let o = 0;
  body[o++] = conv.length & 0xff;
  conv.copy(body, o);
  o += conv.length;
  u32be(atSec).copy(body, o);
  return Buffer.concat([
    buildHeader(BlypWsOpcode.CONVERSATION_PRESENCE, body.length, FLAG_COMPACT),
    body,
  ]);
}

function decodeConversationPresenceCompact(payload) {
  if (payload.length < 6) return null;
  let o = 0;
  const convLen = payload[o++];
  if (o + convLen + 4 > payload.length) return null;
  const conversationId = payload.subarray(o, o + convLen).toString("utf8");
  o += convLen;
  const atSec = readU32be(payload, o);
  return {
    type: "conversation_presence",
    conversationId,
    at: unixSecToIso(atSec),
  };
}

export function encodeConversationTypingCompact(payload) {
  const conv = Buffer.from(String(payload.conversationId ?? "").slice(0, 64), "utf8");
  const onRaw = payload.on;
  const on = !(onRaw === false || onRaw === 0 || onRaw === "0");
  const fromName = String(payload.fromName ?? "").trim();
  const fromBytes = fromName
    ? Buffer.from(fromName.slice(0, 48), "utf8")
    : Buffer.alloc(0);
  const presenceSec = payload.presenceAt ? isoToUnixSec(payload.presenceAt) : 0;
  let flags = on ? 1 : 0;
  if (fromBytes.length) flags |= 2;
  if (presenceSec > 0) flags |= 4;
  const body = Buffer.alloc(
    1 +
      conv.length +
      1 +
      (fromBytes.length ? 1 + fromBytes.length : 0) +
      (presenceSec > 0 ? 4 : 0),
  );
  let o = 0;
  body[o++] = conv.length & 0xff;
  conv.copy(body, o);
  o += conv.length;
  body[o++] = flags & 0xff;
  if (fromBytes.length) {
    body[o++] = fromBytes.length & 0xff;
    fromBytes.copy(body, o);
    o += fromBytes.length;
  }
  if (presenceSec > 0) {
    u32be(presenceSec).copy(body, o);
  }
  return Buffer.concat([
    buildHeader(BlypWsOpcode.CONVERSATION_TYPING, body.length, FLAG_COMPACT),
    body,
  ]);
}

function decodeConversationTypingCompact(payload) {
  if (payload.length < 3) return null;
  let o = 0;
  const convLen = payload[o++];
  if (o + convLen + 1 > payload.length) return null;
  const conversationId = payload.subarray(o, o + convLen).toString("utf8");
  o += convLen;
  const flags = payload[o++];
  const on = (flags & 1) !== 0;
  let fromName = "";
  if (flags & 2) {
    if (o >= payload.length) return null;
    const nameLen = payload[o++];
    if (o + nameLen > payload.length) return null;
    fromName = payload.subarray(o, o + nameLen).toString("utf8");
    o += nameLen;
  }
  let presenceAt;
  if (flags & 4) {
    if (o + 4 > payload.length) return null;
    presenceAt = unixSecToIso(readU32be(payload, o));
  }
  const out = {
    type: "conversation_typing",
    conversationId,
    on: on ? "1" : "0",
  };
  if (fromName) out.fromName = fromName;
  if (presenceAt) out.presenceAt = presenceAt;
  return out;
}

export function encodePongFrame() {
  return buildHeader(BlypWsOpcode.PONG, 0, 0);
}

export function encodeServerPayload(payload) {
  const type = String(payload.type ?? "");
  if (type === "pong") return encodePongFrame();
  if (type === "payment_received") {
    return encodePaymentReceivedCompact({
      transactionId: String(payload.transactionId ?? ""),
      amountFcfa: Number(payload.amountFcfa) || 0,
      fromName: String(payload.fromName ?? ""),
      contextType: String(payload.contextType ?? ""),
      commerceId: payload.commerceId,
    });
  }
  if (type === "conversation_presence") {
    return encodeConversationPresenceCompact({
      conversationId: String(payload.conversationId ?? ""),
      at: String(payload.at ?? ""),
    });
  }
  if (type === "conversation_typing") {
    return encodeConversationTypingCompact({
      conversationId: String(payload.conversationId ?? ""),
      fromName: String(payload.fromName ?? ""),
      on: payload.on,
      presenceAt: payload.presenceAt,
    });
  }
  return encodeChatJsonPayload(payload);
}

export function decodeWsFrame(input) {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length < HEADER_LEN) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x59) return null;
  if (bytes[2] !== VERSION) return null;
  const flags = bytes[3];
  const opcode = bytes[4];
  const len = readU32be(bytes, 5);
  if (HEADER_LEN + len > bytes.length) return null;
  const payload = bytes.subarray(HEADER_LEN, HEADER_LEN + len);

  if (opcode === BlypWsOpcode.PONG) return { type: "pong" };
  if (opcode === BlypWsOpcode.PING) return { action: "ping" };
  if (opcode === BlypWsOpcode.PAYMENT_RECEIVED) {
    if (flags & FLAG_COMPACT) return decodePaymentReceivedCompact(payload);
    try {
      return JSON.parse(payload.toString("utf8"));
    } catch {
      return null;
    }
  }
  if (opcode === BlypWsOpcode.CHAT_JSON) {
    try {
      return JSON.parse(payload.toString("utf8"));
    } catch {
      return null;
    }
  }
  if (opcode === BlypWsOpcode.CONVERSATION_PRESENCE && flags & FLAG_COMPACT) {
    return decodeConversationPresenceCompact(payload);
  }
  if (opcode === BlypWsOpcode.CONVERSATION_TYPING && flags & FLAG_COMPACT) {
    return decodeConversationTypingCompact(payload);
  }
  return null;
}

export function decodeClientBody(eventBody, isBase64Encoded) {
  if (!eventBody) return null;
  if (isBase64Encoded) {
    try {
      return decodeWsFrame(Buffer.from(eventBody, "base64"));
    } catch {
      return null;
    }
  }
  const trimmed = String(eventBody).trim();
  if (trimmed.startsWith("{")) {
    return decodeWsFrame(trimmed);
  }
  try {
    return decodeWsFrame(Buffer.from(eventBody, "base64"));
  } catch {
    return decodeWsFrame(trimmed);
  }
}

export function encodeClientAction(body) {
  const action = String(body.action ?? "").toLowerCase();
  if (action === "ping") {
    return buildHeader(BlypWsOpcode.PING, 0, 0);
  }
  return encodeChatJsonPayload(body);
}
