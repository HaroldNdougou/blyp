import type { ApiUser } from "@/lib/api/types";

/** Montants ≤ 1 000 FCFA (aligné serveur). */
export const SMALL_PAY_MAX_FCFA = 1_000;

/** Cumul sans PIN par jour (UTC). */
export const SMALL_PAY_DAILY_MAX_SUM_FCFA = 2_000;
/** Cumul sans PIN depuis le dernier paiement avec PIN. */
export const SMALL_PAY_PERIOD_MAX_SUM_FCFA = 5_000;

export function isSmallPayAmount(amountFcfa: number): boolean {
  const n = Math.floor(Number(amountFcfa));
  return Number.isFinite(n) && n > 0 && n <= SMALL_PAY_MAX_FCFA;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function dailySumForUser(user: ApiUser): number {
  const day = todayUtc();
  if (String(user.smallPayStatsDay ?? "") !== day) return 0;
  return Number(user.smallPayStatsSumFcfa ?? 0);
}

function periodSumForUser(user: ApiUser): number {
  return Number(user.smallPayPeriodWithoutPinSumFcfa ?? 0);
}

/** Aligné `aws/lib/smallPay.mjs` — décision côté app avant envoi sans PIN. */
export function evaluateSmallPayPinSkip(
  user: ApiUser | null | undefined,
  amountFcfa: number,
): { allowSkipPin: boolean; requirePinForLimit?: boolean } {
  if (!user?.smallPayWithoutPinEnabled) {
    return { allowSkipPin: false };
  }
  if (!isSmallPayAmount(amountFcfa)) {
    return { allowSkipPin: false };
  }
  const amt = Math.floor(Number(amountFcfa));
  const nextDaily = dailySumForUser(user) + amt;
  const nextPeriod = periodSumForUser(user) + amt;
  if (
    nextDaily > SMALL_PAY_DAILY_MAX_SUM_FCFA ||
    nextPeriod > SMALL_PAY_PERIOD_MAX_SUM_FCFA
  ) {
    return { allowSkipPin: false, requirePinForLimit: true };
  }
  return { allowSkipPin: true };
}

export function canSkipPayPinForAmount(
  user: ApiUser | null | undefined,
  amountFcfa: number,
): boolean {
  return evaluateSmallPayPinSkip(user, amountFcfa).allowSkipPin;
}
