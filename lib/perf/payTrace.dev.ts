/**
 * Chronologie paiement payeur — logs `[perf] pay→…` (Metro, dev uniquement).
 */
let payT0: number | null = null;

export function payTraceStart(reason: string): void {
  payT0 = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[perf] pay.trace START (${reason})`);
}

export function payTraceLap(step: string): void {
  if (payT0 == null) return;
  // eslint-disable-next-line no-console
  console.log(`[perf] pay→${step}: ${Date.now() - payT0}ms`);
}

export function payTraceMilestone(step: string, keepOpen = false): void {
  if (payT0 == null) return;
  const ms = Date.now() - payT0;
  // eslint-disable-next-line no-console
  console.log(`[perf] pay.${step}: ${ms}ms`);
  if (!keepOpen) payT0 = null;
}

export function payTraceAbort(reason?: string): void {
  if (payT0 != null && reason) {
    // eslint-disable-next-line no-console
    console.log(`[perf] pay.trace ABORT (${reason}) @ ${Date.now() - payT0}ms`);
  }
  payT0 = null;
}

export function payTraceLogTxId(txId: string | null | undefined): void {
  const id = String(txId ?? "").trim();
  if (!id) return;
  // eslint-disable-next-line no-console
  console.log(
    `[perf] pay.tx=${id.slice(0, 8)}… (coller avec merchant→rx)`,
  );
}
