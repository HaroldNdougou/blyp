/**
 * Pont minimal (sans contexte) : après un rechargement réussi, l’écran paiement
 * récupère le montant au prochain focus.
 */
let pendingDepositFcfa: number | null = null;

export function setPendingDepositAmountForPayHome(fcfa: number) {
  if (Number.isFinite(fcfa) && fcfa > 0) {
    pendingDepositFcfa = Math.floor(fcfa);
  }
}

export function consumePendingDepositAmountForPayHome(): number | null {
  const v = pendingDepositFcfa;
  pendingDepositFcfa = null;
  return v;
}
