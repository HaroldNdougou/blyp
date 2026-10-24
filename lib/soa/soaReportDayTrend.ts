export type SoaReportRevenueTrend = "up" | "down";

/** Compare le total du jour affiché au jour précédent dans la liste (ex. hier). */
export function resolveSoaReportRevenueTrend(
  currentTotalFcfa: number,
  previousDayTotalFcfa: number | null | undefined,
): SoaReportRevenueTrend | null {
  if (previousDayTotalFcfa == null) return null;
  if (currentTotalFcfa > previousDayTotalFcfa) return "up";
  if (currentTotalFcfa < previousDayTotalFcfa) return "down";
  return null;
}

/** Variation en % vs le jour précédent (arrondi entier). */
export function formatSoaReportGrowthRate(
  currentTotalFcfa: number,
  previousDayTotalFcfa: number,
): string {
  if (previousDayTotalFcfa <= 0) {
    return currentTotalFcfa > 0 ? "+100 %" : "0 %";
  }
  const pct =
    ((currentTotalFcfa - previousDayTotalFcfa) / previousDayTotalFcfa) * 100;
  const rounded = Math.round(pct);
  if (rounded > 0) return `+${rounded} %`;
  if (rounded < 0) return `${rounded} %`;
  return "0 %";
}
