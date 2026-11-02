import type { ApiUser } from "@/lib/api/types";

/** Montants strictement ≤ 499 FCFA (aligné serveur). */
export const SMALL_PAY_MAX_FCFA = 499;

export function canSkipPayPinForAmount(
  user: ApiUser | null | undefined,
  amountFcfa: number,
): boolean {
  if (!user?.smallPayWithoutPinEnabled) return false;
  const n = Math.floor(amountFcfa);
  return n > 0 && n <= SMALL_PAY_MAX_FCFA;
}
