/** Throttle sync historique / solde — le pay et les push passent toujours. */

export type TxSyncReason =
  | "poll"
  | "boot"
  | "warm"
  | "foreground"
  | "reconnect"
  | "history"
  | "commerce_focus"
  | "pocket"
  | "pay"
  | "push"
  | "context_switch"
  | "commerce_create";

const BYPASS_GATE: ReadonlySet<TxSyncReason> = new Set([
  "pay",
  "push",
  "context_switch",
  "commerce_create",
]);

/** Sync fond (poll, warm, boot…) — pas plus souvent sauf bypass. */
const BACKGROUND_MIN_INTERVAL_MS = 180_000;

let lastNetworkSyncAtMs = 0;

export function shouldSyncTransactions(reason: TxSyncReason): boolean {
  if (BYPASS_GATE.has(reason)) return true;
  return Date.now() - lastNetworkSyncAtMs >= BACKGROUND_MIN_INTERVAL_MS;
}

export function markTransactionsNetworkSyncDone(): void {
  lastNetworkSyncAtMs = Date.now();
}

export function resetTransactionsPullGateForTests(): void {
  lastNetworkSyncAtMs = 0;
}
