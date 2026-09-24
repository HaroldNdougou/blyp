/** Taux frais Pay sous 100 F — ex. 50 F → 5 F. */
export const PAY_FEE_RATE = 0.1;

/** Frais fixes à partir de 100 F (inclus). */
export const PAY_FEE_FLAT_FCFA = 10;
export const PAY_FEE_FLAT_MIN_AMOUNT_FCFA = 100;

export function computePayFeeFcfa(amountFcfa: number): number {
  if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) return 0;
  if (amountFcfa >= PAY_FEE_FLAT_MIN_AMOUNT_FCFA) return PAY_FEE_FLAT_FCFA;
  return Math.round(amountFcfa * PAY_FEE_RATE);
}
