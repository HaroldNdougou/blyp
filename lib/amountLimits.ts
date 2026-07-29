/** Plafond montant FCFA — 6 chiffres (COBAC/BEAC, sans agrément au démarrage). */
export const MAX_AMOUNT_FCFA = 999_999;

export const MAX_AMOUNT_DIGITS = 6;

export function digitsOnlyAmount(raw: string, maxDigits = MAX_AMOUNT_DIGITS): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, maxDigits);
}

/** Montant FCFA entier strictement positif, ou `null` si invalide. */
export function parseAmountFcfa(raw: string): number | null {
  const digits = digitsOnlyAmount(raw);
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT_FCFA) return null;
  return n;
}

export function isValidAmountFcfa(raw: string): boolean {
  return parseAmountFcfa(raw) != null;
}
