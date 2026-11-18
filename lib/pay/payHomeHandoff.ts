/** Passage coquille Pay → PayHomeScreen (cold start). */
let shellDigits = "";
let pendingPayAmountFcfa: number | null = null;
const listeners = new Set<() => void>();

export function setShellPayDigits(digits: string): void {
  shellDigits = digits.replace(/\D/g, "").slice(0, 12);
}

export function takeShellPayDigits(): string {
  const d = shellDigits;
  shellDigits = "";
  return d;
}

export function queuePayAmountFromShell(amountFcfa: number): void {
  const n = Math.floor(amountFcfa);
  if (n <= 0) return;
  pendingPayAmountFcfa = n;
  for (const fn of listeners) fn();
}

export function takePendingPayAmountFcfa(): number | null {
  const v = pendingPayAmountFcfa;
  pendingPayAmountFcfa = null;
  return v;
}

export function subscribePayHomeHandoff(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
