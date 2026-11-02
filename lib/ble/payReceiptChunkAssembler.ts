import type { PayReceiptChunkFrame } from "@/lib/ble/payReceiptChunkCodec";
import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import {
  buildReceiptSignMessage,
  verifyCommercePaymentReceiptSync,
} from "@/lib/pay/paymentReceipt";

type TransferState = {
  transferId: number;
  total: number;
  parts: Map<number, Uint8Array>;
  updatedAt: number;
};

const transfers = new Map<number, TransferState>();
const STALE_MS = 15_000;

function pruneStale(): void {
  const now = Date.now();
  for (const [id, st] of transfers) {
    if (now - st.updatedAt > STALE_MS) transfers.delete(id);
  }
}

export function ingestPayReceiptChunk(
  frame: PayReceiptChunkFrame,
): CommercePaymentReceipt | null {
  pruneStale();
  let st = transfers.get(frame.transferId);
  if (!st || st.total !== frame.total) {
    st = {
      transferId: frame.transferId,
      total: frame.total,
      parts: new Map(),
      updatedAt: Date.now(),
    };
    transfers.set(frame.transferId, st);
  }
  st.parts.set(frame.index, frame.data);
  st.updatedAt = Date.now();
  if (st.parts.size < st.total) return null;

  const bufParts: Uint8Array[] = [];
  for (let i = 0; i < st.total; i++) {
    const part = st.parts.get(i);
    if (!part) return null;
    bufParts.push(part);
  }

  transfers.delete(frame.transferId);

  let len = 0;
  for (const p of bufParts) len += p.length;
  const buf = new Uint8Array(len);
  let off = 0;
  for (const p of bufParts) {
    buf.set(p, off);
    off += p.length;
  }

  const sep = buf.indexOf(0);
  if (sep < 0) return null;
  const json = new TextDecoder().decode(buf.subarray(0, sep));
  const sigBytes = buf.subarray(sep + 1, sep + 1 + 64);
  if (sigBytes.length !== 64) return null;

  let receipt: CommercePaymentReceipt;
  try {
    receipt = JSON.parse(json) as CommercePaymentReceipt;
  } catch {
    return null;
  }
  if (receipt.v !== 2) return null;

  let bin = "";
  for (let i = 0; i < sigBytes.length; i++) bin += String.fromCharCode(sigBytes[i]!);
  receipt.sig = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (buildReceiptSignMessage(receipt) !== json) return null;
  if (!verifyCommercePaymentReceiptSync(receipt)) return null;
  return receipt;
}
