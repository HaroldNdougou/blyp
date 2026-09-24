export type IncomingPaymentFlash = {
  amountFcfa: number;
  transactionId?: string;
  commerceId?: string;
  contextType?: "commerce" | "personal";
};

type Listener = (event: IncomingPaymentFlash) => void;

const listeners = new Set<Listener>();

export function subscribeIncomingPaymentFlash(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function notifyIncomingPaymentFlash(event: IncomingPaymentFlash): void {
  const amountFcfa = Math.floor(Number(event.amountFcfa) || 0);
  if (amountFcfa <= 0) return;
  const next: IncomingPaymentFlash = {
    amountFcfa,
    transactionId: event.transactionId,
    commerceId: event.commerceId,
    contextType: event.contextType,
  };
  for (const cb of listeners) cb(next);
}
