import { base64ToBytes } from "@/lib/ble/base64";
import { BLYP_BLE_COMPANY_ID } from "@/lib/ble/constants";
import { accountIdToCode } from "@/lib/ble/payload";
import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import { buildReceiptSignMessage } from "@/lib/pay/paymentReceipt";

const MAGIC0 = 0x42;
const MAGIC_CHUNK = 0x43; // C — chunk relai preuve
const CHUNK_DATA_LEN = 18;
const MAX_CHUNKS = 24;

export type PayReceiptChunkFrame = {
  transferId: number;
  index: number;
  total: number;
  data: Uint8Array;
};

export function receiptToTransferBytes(receipt: CommercePaymentReceipt): Uint8Array {
  const json = buildReceiptSignMessage(receipt);
  const sigBytes = base64UrlToBytes(receipt.sig);
  if (!sigBytes) return new TextEncoder().encode(json);
  const combined = new Uint8Array(json.length + 1 + sigBytes.length);
  combined.set(new TextEncoder().encode(json), 0);
  combined[json.length] = 0;
  combined.set(sigBytes, json.length + 1);
  return combined;
}

function base64UrlToBytes(sig: string): Uint8Array | null {
  try {
    const pad =
      sig.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (sig.length % 4)) % 4);
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length === 64 ? out : null;
  } catch {
    return null;
  }
}

export function splitReceiptTransfer(
  receipt: CommercePaymentReceipt,
): { transferId: number; frames: PayReceiptChunkFrame[] } {
  const payload = receiptToTransferBytes(receipt);
  const transferId = (Date.now() & 0xffff) ^ (payload.length << 5);
  const total = Math.ceil(payload.length / CHUNK_DATA_LEN);
  const frames: PayReceiptChunkFrame[] = [];
  for (let i = 0; i < total && i < MAX_CHUNKS; i++) {
    const start = i * CHUNK_DATA_LEN;
    const slice = payload.subarray(start, start + CHUNK_DATA_LEN);
    const data = new Uint8Array(CHUNK_DATA_LEN);
    data.set(slice);
    frames.push({
      transferId: transferId >>> 0,
      index: i,
      total,
      data,
    });
  }
  return { transferId: transferId >>> 0, frames };
}

export function encodePayReceiptChunkManuf(frame: PayReceiptChunkFrame): number[] {
  if (frame.total > MAX_CHUNKS || frame.index >= frame.total) return [];
  const out: number[] = [
    MAGIC0,
    MAGIC_CHUNK,
    frame.transferId & 0xff,
    (frame.transferId >> 8) & 0xff,
    frame.index & 0xff,
    frame.total & 0xff,
  ];
  for (let i = 0; i < CHUNK_DATA_LEN; i++) {
    out.push(frame.data[i] ?? 0);
  }
  return out;
}

function findCompanyOffset(raw: Uint8Array): number {
  if (raw.length >= 2) {
    const companyLe = raw[0]! | (raw[1]! << 8);
    const companyBe = (raw[0]! << 8) | raw[1]!;
    if (companyLe === BLYP_BLE_COMPANY_ID || companyBe === BLYP_BLE_COMPANY_ID) {
      return 2;
    }
  }
  return 0;
}

export function parsePayReceiptChunkFromBytes(
  raw: Uint8Array | null,
): PayReceiptChunkFrame | null {
  if (!raw) return null;
  for (let offset = 0; offset <= findCompanyOffset(raw); offset += offset ? 0 : 1) {
    const o = offset === 1 ? findCompanyOffset(raw) : offset;
    if (raw.length - o < 6 + CHUNK_DATA_LEN) continue;
    if (raw[o] !== MAGIC0 || raw[o + 1] !== MAGIC_CHUNK) continue;
    const transferId = raw[o + 2]! | (raw[o + 3]! << 8);
    const index = raw[o + 4]!;
    const total = raw[o + 5]!;
    if (total === 0 || index >= total || total > MAX_CHUNKS) continue;
    const data = raw.subarray(o + 6, o + 6 + CHUNK_DATA_LEN);
    return { transferId, index, total, data: new Uint8Array(data) };
  }
  for (let i = 0; i + 6 + CHUNK_DATA_LEN <= raw.length; i++) {
    if (raw[i] !== MAGIC0 || raw[i + 1] !== MAGIC_CHUNK) continue;
    const transferId = raw[i + 2]! | (raw[i + 3]! << 8);
    const index = raw[i + 4]!;
    const total = raw[i + 5]!;
    if (total === 0 || index >= total || total > MAX_CHUNKS) continue;
    const data = raw.subarray(i + 6, i + 6 + CHUNK_DATA_LEN);
    return { transferId, index, total, data: new Uint8Array(data) };
  }
  return null;
}

export function parsePayReceiptChunkFromScan(input: {
  manufacturerData?: string | null;
  rawScanRecord?: string | null;
}): PayReceiptChunkFrame | null {
  if (input.manufacturerData) {
    const raw = base64ToBytes(input.manufacturerData);
    const hit = raw ? parsePayReceiptChunkFromBytes(raw) : null;
    if (hit) return hit;
  }
  if (input.rawScanRecord) {
    const raw = base64ToBytes(input.rawScanRecord);
    return raw ? parsePayReceiptChunkFromBytes(raw) : null;
  }
  return null;
}

/** Session caisse — annonce BS + session 4o + code commerce 10o */
const MAGIC_SESSION = 0x53; // S

export function encodeCashierSessionManuf(input: {
  sessionId: number;
  accountId: string;
}): number[] | null {
  const parsed = accountIdToCode(input.accountId);
  if (!parsed || parsed.kind !== "commerce") return null;
  const sid = Math.floor(input.sessionId) >>> 0;
  const out: number[] = [
    MAGIC0,
    MAGIC_SESSION,
    sid & 0xff,
    (sid >> 8) & 0xff,
    (sid >> 16) & 0xff,
    (sid >> 24) & 0xff,
  ];
  for (let i = 0; i < 10; i++) {
    out.push(parsed.code.charCodeAt(i));
  }
  return out;
}

export type ParsedCashierSessionAd = {
  sessionId: number;
  accountId: string;
};

export function parseCashierSessionFromBytes(
  raw: Uint8Array | null,
): ParsedCashierSessionAd | null {
  if (!raw || raw.length < 16) return null;
  const tryAt = (o: number): ParsedCashierSessionAd | null => {
    if (raw.length - o < 16) return null;
    if (raw[o] !== MAGIC0 || raw[o + 1] !== MAGIC_SESSION) return null;
    const sessionId =
      raw[o + 2]! |
      (raw[o + 3]! << 8) |
      (raw[o + 4]! << 16) |
      (raw[o + 5]! << 24);
    let code = "";
    for (let i = 0; i < 10; i++) {
      const b = raw[o + 6 + i]!;
      if (b < 0x30 || b > 0x7a) return null;
      code += String.fromCharCode(b);
    }
    if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) return null;
    return {
      sessionId: sessionId >>> 0,
      accountId: `BLYP-C-${code}`,
    };
  };
  const off = findCompanyOffset(raw);
  return tryAt(off) ?? tryAt(0);
}

export function parseCashierSessionFromScan(input: {
  manufacturerData?: string | null;
  rawScanRecord?: string | null;
}): ParsedCashierSessionAd | null {
  if (input.manufacturerData) {
    const raw = base64ToBytes(input.manufacturerData);
    const hit = raw ? parseCashierSessionFromBytes(raw) : null;
    if (hit) return hit;
  }
  if (input.rawScanRecord) {
    const raw = base64ToBytes(input.rawScanRecord);
    return raw ? parseCashierSessionFromBytes(raw) : null;
  }
  return null;
}
