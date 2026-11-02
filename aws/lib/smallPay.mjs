/** Montant strictement inférieur à 500 FCFA — paiement sans PIN si opt-in. */
export const SMALL_PAY_MAX_FCFA = 499;

/** Cumul sans PIN par jour (UTC). */
export const SMALL_PAY_DAILY_MAX_SUM_FCFA = 2_000;
/** Cumul sans PIN depuis le dernier paiement avec PIN. */
export const SMALL_PAY_PERIOD_MAX_SUM_FCFA = 5_000;

export function isSmallPayAmount(amount) {
  const n = Math.floor(Number(amount));
  return Number.isFinite(n) && n > 0 && n <= SMALL_PAY_MAX_FCFA;
}

export function isSmallPayWithoutPinEnabled(profile) {
  return profile?.smallPayWithoutPinEnabled === true;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function dailySumForProfile(profile) {
  const day = todayUtc();
  if (String(profile.smallPayStatsDay ?? "") !== day) return 0;
  return Number(profile.smallPayStatsSumFcfa ?? 0);
}

function periodSumForProfile(profile) {
  return Number(profile.smallPayPeriodWithoutPinSumFcfa ?? 0);
}

/** @returns {{ allowSkipPin: boolean, requirePinForLimit?: boolean }} */
export function evaluateSmallPayPinSkip(profile, amount) {
  if (!isSmallPayAmount(amount) || !isSmallPayWithoutPinEnabled(profile)) {
    return { allowSkipPin: false };
  }
  const amt = Math.floor(Number(amount));
  const nextDaily = dailySumForProfile(profile) + amt;
  const nextPeriod = periodSumForProfile(profile) + amt;
  if (
    nextDaily > SMALL_PAY_DAILY_MAX_SUM_FCFA ||
    nextPeriod > SMALL_PAY_PERIOD_MAX_SUM_FCFA
  ) {
    return { allowSkipPin: false, requirePinForLimit: true };
  }
  return { allowSkipPin: true };
}

export function smallPayStatsAfterSuccess(profile, amount) {
  const day = todayUtc();
  const amt = Math.floor(Number(amount));
  const dailyBase = dailySumForProfile(profile);
  const periodBase = periodSumForProfile(profile);
  return {
    smallPayStatsDay: day,
    smallPayStatsCount: Number(profile.smallPayStatsCount ?? 0) + 1,
    smallPayStatsSumFcfa: dailyBase + amt,
    smallPayPeriodWithoutPinSumFcfa: periodBase + amt,
  };
}
