import type { MerchantPayRxSource } from "./merchantPayTrace.types";

const rxAtByTx = new Map<string, number>();
const MAX_TX = 48;

function trimTx(txId: string | undefined): string {
  const id = String(txId ?? "").trim();
  return id.length > 12 ? `${id.slice(0, 8)}…` : id || "?";
}

export function merchantPayRx(source: MerchantPayRxSource, txId?: string): void {
  const id = String(txId ?? "").trim();
  const t = Date.now();
  if (id) {
    rxAtByTx.set(id, t);
    if (rxAtByTx.size > MAX_TX) {
      const first = rxAtByTx.keys().next().value;
      if (first) rxAtByTx.delete(first);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[perf] merchant→rx (${source}) tx=${trimTx(id)}`);
}

export function merchantPayApplied(txId?: string): void {
  const id = String(txId ?? "").trim();
  const t0 = id ? rxAtByTx.get(id) : undefined;
  const delta = t0 != null ? Date.now() - t0 : null;
  const suffix = delta != null ? ` +${delta}ms depuis rx` : "";
  // eslint-disable-next-line no-console
  console.log(`[perf] merchant→solde_flash tx=${trimTx(id)}${suffix}`);
}

export function merchantPayVoiceDone(txId?: string): void {
  const id = String(txId ?? "").trim();
  const t0 = id ? rxAtByTx.get(id) : undefined;
  const delta = t0 != null ? Date.now() - t0 : null;
  const suffix = delta != null ? ` +${delta}ms depuis rx` : "";
  // eslint-disable-next-line no-console
  console.log(`[perf] merchant→voix tx=${trimTx(id)}${suffix}`);
}

export function merchantPayUiFlash(txId?: string): void {
  const id = String(txId ?? "").trim();
  const t0 = id ? rxAtByTx.get(id) : undefined;
  const delta = t0 != null ? Date.now() - t0 : null;
  const suffix = delta != null ? ` +${delta}ms depuis rx` : "";
  // eslint-disable-next-line no-console
  console.log(`[perf] merchant→flash_ui tx=${trimTx(id)}${suffix}`);
}
