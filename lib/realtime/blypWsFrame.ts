/**
 * Blyp realtime v1 — frames binaires WebSocket (style WhatsApp : connexion unique, payloads compacts).
 *
 * Frame: BY (2) | ver u8 | flags u8 | opcode u8 | len u32 BE | payload
 * flags bit0: payload compact (payment) vs UTF-8 JSON
 */

export const BLYP_WS_MAGIC = 0x4259; // 'BY' big-endian in first 2 bytes: 0x42, 0x59

export const BlypWsOpcode = {
  PING: 0x01,
  PONG: 0x02,
  PAYMENT_RECEIVED: 0x10,
  CHAT_JSON: 0x20,
  CONVERSATION_PRESENCE: 0x21,
  CONVERSATION_TYPING: 0x22,
} as const;

const HEADER_LEN = 9;
const VERSION = 1;
const FLAG_COMPACT = 1;

function u32be(n: number): number[] {
  const v = Math.max(0, Math.floor(n)) >>> 0;
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function readU32be(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off]! << 24) |
      (bytes[off + 1]! << 16) |
      (bytes[off + 2]! << 8) |
      bytes[off + 3]!) >>>
    0
  );
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function buildHeader(opcode: number, payloadLen: number, flags: number): Uint8Array {
  const h = new Uint8Array(HEADER_LEN);
  h[0] = 0x42;
  h[1] = 0x59;
  h[2] = VERSION;
  h[3] = flags & 0xff;
  h[4] = opcode & 0xff;
  const len = u32be(payloadLen);
  h[5] = len[0]!;
  h[6] = len[1]!;
  h[7] = len[2]!;
  h[8] = len[3]!;
  return h;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Encode paiement reçu (sans JSON). */
export function encodePaymentReceivedCompact(payload: {
  transactionId: string;
  amountFcfa: number;
  fromName: string;
  contextType?: string;
  commerceId?: string | null;
}): Uint8Array {
  const txId = utf8Encode(String(payload.transactionId ?? "").slice(0, 120));
  const fromName = utf8Encode(String(payload.fromName ?? "").slice(0, 80));
  const ctx =
    String(payload.contextType ?? "") === "commerce" ? 1 : 0;
  const commerceRaw = String(payload.commerceId ?? "").trim();
  const commerce = ctx === 1 ? utf8Encode(commerceRaw.slice(0, 64)) : new Uint8Array(0);
  const amount = Math.max(0, Math.floor(Number(payload.amountFcfa) || 0)) >>> 0;

  const bodyLen = 1 + txId.length + 4 + 1 + fromName.length + 1 + 1 + commerce.length;
  const body = new Uint8Array(bodyLen);
  let o = 0;
  body[o++] = txId.length & 0xff;
  body.set(txId, o);
  o += txId.length;
  const am = u32be(amount);
  body[o++] = am[0]!;
  body[o++] = am[1]!;
  body[o++] = am[2]!;
  body[o++] = am[3]!;
  body[o++] = fromName.length & 0xff;
  body.set(fromName, o);
  o += fromName.length;
  body[o++] = ctx & 0xff;
  body[o++] = commerce.length & 0xff;
  if (commerce.length) {
    body.set(commerce, o);
  }
  return concat(buildHeader(BlypWsOpcode.PAYMENT_RECEIVED, body.length, FLAG_COMPACT), body);
}

function decodePaymentReceivedCompact(payload: Uint8Array): Record<string, unknown> | null {
  if (payload.length < 8) return null;
  let o = 0;
  const txLen = payload[o++]!;
  if (o + txLen + 4 > payload.length) return null;
  const txId = utf8Decode(payload.subarray(o, o + txLen));
  o += txLen;
  const amount = readU32be(payload, o);
  o += 4;
  if (o >= payload.length) return null;
  const nameLen = payload[o++]!;
  if (o + nameLen + 2 > payload.length) return null;
  const fromName = utf8Decode(payload.subarray(o, o + nameLen));
  o += nameLen;
  const ctx = payload[o++]!;
  const commerceLen = payload[o++]!;
  if (o + commerceLen > payload.length) return null;
  const commerceId =
    commerceLen > 0 ? utf8Decode(payload.subarray(o, o + commerceLen)) : null;
  return {
    type: "payment_received",
    transactionId: txId,
    amountFcfa: amount,
    fromName,
    contextType: ctx === 1 ? "commerce" : "personal",
    commerceId: commerceId || null,
  };
}

function isoToUnixSec(iso: string | null | undefined): number {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 1000));
}

function unixSecToIso(sec: number): string {
  if (sec <= 0) return new Date().toISOString();
  return new Date(sec * 1000).toISOString();
}

export function encodeConversationPresenceCompact(payload: {
  conversationId: string;
  at: string;
}): Uint8Array {
  const conv = utf8Encode(String(payload.conversationId ?? "").slice(0, 64));
  const atSec = isoToUnixSec(payload.at);
  const body = new Uint8Array(1 + conv.length + 4);
  let o = 0;
  body[o++] = conv.length & 0xff;
  body.set(conv, o);
  o += conv.length;
  const t = u32be(atSec);
  body[o++] = t[0]!;
  body[o++] = t[1]!;
  body[o++] = t[2]!;
  body[o++] = t[3]!;
  return concat(
    buildHeader(BlypWsOpcode.CONVERSATION_PRESENCE, body.length, FLAG_COMPACT),
    body,
  );
}

function decodeConversationPresenceCompact(
  payload: Uint8Array,
): Record<string, unknown> | null {
  if (payload.length < 6) return null;
  let o = 0;
  const convLen = payload[o++]!;
  if (o + convLen + 4 > payload.length) return null;
  const conversationId = utf8Decode(payload.subarray(o, o + convLen));
  o += convLen;
  const atSec = readU32be(payload, o);
  return {
    type: "conversation_presence",
    conversationId,
    at: unixSecToIso(atSec),
  };
}

export function encodeConversationTypingCompact(payload: {
  conversationId: string;
  fromName?: string;
  on?: unknown;
  presenceAt?: string | null;
}): Uint8Array {
  const conv = utf8Encode(String(payload.conversationId ?? "").slice(0, 64));
  const onRaw = payload.on;
  const on = !(onRaw === false || onRaw === 0 || onRaw === "0");
  const fromName = String(payload.fromName ?? "").trim();
  const fromBytes = fromName ? utf8Encode(fromName.slice(0, 48)) : new Uint8Array(0);
  const presenceSec = payload.presenceAt ? isoToUnixSec(payload.presenceAt) : 0;
  let flags = on ? 1 : 0;
  if (fromBytes.length) flags |= 2;
  if (presenceSec > 0) flags |= 4;
  const bodyLen = 1 + conv.length + 1 + (fromBytes.length ? 1 + fromBytes.length : 0) + (presenceSec > 0 ? 4 : 0);
  const body = new Uint8Array(bodyLen);
  let o = 0;
  body[o++] = conv.length & 0xff;
  body.set(conv, o);
  o += conv.length;
  body[o++] = flags & 0xff;
  if (fromBytes.length) {
    body[o++] = fromBytes.length & 0xff;
    body.set(fromBytes, o);
    o += fromBytes.length;
  }
  if (presenceSec > 0) {
    const t = u32be(presenceSec);
    body[o++] = t[0]!;
    body[o++] = t[1]!;
    body[o++] = t[2]!;
    body[o++] = t[3]!;
  }
  return concat(
    buildHeader(BlypWsOpcode.CONVERSATION_TYPING, body.length, FLAG_COMPACT),
    body,
  );
}

function decodeConversationTypingCompact(
  payload: Uint8Array,
): Record<string, unknown> | null {
  if (payload.length < 3) return null;
  let o = 0;
  const convLen = payload[o++]!;
  if (o + convLen + 1 > payload.length) return null;
  const conversationId = utf8Decode(payload.subarray(o, o + convLen));
  o += convLen;
  const flags = payload[o++]!;
  const on = (flags & 1) !== 0;
  let fromName = "";
  if (flags & 2) {
    if (o >= payload.length) return null;
    const nameLen = payload[o++]!;
    if (o + nameLen > payload.length) return null;
    fromName = utf8Decode(payload.subarray(o, o + nameLen));
    o += nameLen;
  }
  let presenceAt: string | undefined;
  if (flags & 4) {
    if (o + 4 > payload.length) return null;
    presenceAt = unixSecToIso(readU32be(payload, o));
  }
  const out: Record<string, unknown> = {
    type: "conversation_typing",
    conversationId,
    on: on ? "1" : "0",
  };
  if (fromName) out.fromName = fromName;
  if (presenceAt) out.presenceAt = presenceAt;
  return out;
}

export function encodeChatJsonPayload(obj: Record<string, unknown>): Uint8Array {
  const json = utf8Encode(JSON.stringify(obj));
  return concat(buildHeader(BlypWsOpcode.CHAT_JSON, json.length, 0), json);
}

export function encodePingFrame(): Uint8Array {
  return buildHeader(BlypWsOpcode.PING, 0, 0);
}

export function encodePongFrame(): Uint8Array {
  return buildHeader(BlypWsOpcode.PONG, 0, 0);
}

/** Serveur : choisit compact ou JSON selon le type. */
export function encodeServerPayload(payload: Record<string, unknown>): Uint8Array {
  const type = String(payload.type ?? "");
  if (type === "pong") return encodePongFrame();
  if (type === "payment_received") {
    return encodePaymentReceivedCompact({
      transactionId: String(payload.transactionId ?? ""),
      amountFcfa: Number(payload.amountFcfa) || 0,
      fromName: String(payload.fromName ?? ""),
      contextType: String(payload.contextType ?? ""),
      commerceId: payload.commerceId as string | null,
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
      presenceAt: payload.presenceAt as string | null,
    });
  }
  return encodeChatJsonPayload(payload);
}

/** Client → serveur (ping, presence, typing). */
export function encodeClientAction(body: Record<string, unknown>): Uint8Array {
  const action = String(body.action ?? "").toLowerCase();
  if (action === "ping") return encodePingFrame();
  return encodeChatJsonPayload(body);
}

export function decodeWsFrame(input: ArrayBuffer | Uint8Array | string): Record<string, unknown> | null {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_LEN) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x59) return null;
  const ver = bytes[2]!;
  if (ver !== VERSION) return null;
  const flags = bytes[3]!;
  const opcode = bytes[4]!;
  const len = readU32be(bytes, 5);
  if (HEADER_LEN + len > bytes.length) return null;
  const payload = bytes.subarray(HEADER_LEN, HEADER_LEN + len);

  if (opcode === BlypWsOpcode.PONG) {
    return { type: "pong" };
  }
  if (opcode === BlypWsOpcode.PING) {
    return { action: "ping" };
  }
  if (opcode === BlypWsOpcode.PAYMENT_RECEIVED) {
    if (flags & FLAG_COMPACT) {
      return decodePaymentReceivedCompact(payload);
    }
    try {
      return JSON.parse(utf8Decode(payload)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (opcode === BlypWsOpcode.CHAT_JSON) {
    try {
      return JSON.parse(utf8Decode(payload)) as Record<string, unknown>;
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

export function wsMessageToBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return utf8Encode(data);
  return null;
}
