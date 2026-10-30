type QuickPayListener = (amountFcfa: number) => void;

const listeners = new Set<QuickPayListener>();
let pendingAmountFcfa: number | null = null;

export function subscribeQuickPayFlow(listener: QuickPayListener): () => void {
  listeners.add(listener);
  if (pendingAmountFcfa != null) {
    const n = pendingAmountFcfa;
    pendingAmountFcfa = null;
    queueMicrotask(() => listener(n));
  }
  return () => listeners.delete(listener);
}

export function requestQuickPayFromNotif(amountFcfa: number): void {
  const n = Math.floor(amountFcfa);
  if (n <= 0) return;
  if (listeners.size === 0) {
    pendingAmountFcfa = n;
    return;
  }
  for (const l of listeners) l(n);
}
