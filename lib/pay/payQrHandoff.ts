import type { BlypPayQrPayload } from "@/lib/pay/blypPayQr";

let pending: BlypPayQrPayload | null = null;

export function setPendingPayQr(payload: BlypPayQrPayload | null): void {
  pending = payload;
}

export function takePendingPayQr(): BlypPayQrPayload | null {
  const p = pending;
  pending = null;
  return p;
}
