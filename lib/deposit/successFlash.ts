/** Flash one-shot : message de succès recharge affiché sur Pay au retour. */

let pendingAmountFcfa: number | null = null;

export function armTopUpSuccessFlash(amountFcfa: number): void {
  pendingAmountFcfa = Number.isFinite(amountFcfa) && amountFcfa > 0
    ? amountFcfa
    : null;
}

export function takeTopUpSuccessFlash(): number | null {
  const n = pendingAmountFcfa;
  pendingAmountFcfa = null;
  return n;
}
