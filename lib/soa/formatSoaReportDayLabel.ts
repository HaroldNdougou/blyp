import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";

const REPORT_TZ = "Africa/Douala";

/** Midi Douala — évite les décalages DST / minuit UTC. */
function dateFromDayKey(dayKey: string): Date {
  return new Date(`${String(dayKey).trim()}T12:00:00+01:00`);
}

function capitalizeLabel(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function yearInReportTz(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
  }).format(d);
}

/**
 * 0 = aujourd’hui, 1 = hier, 2–6 = jour de la semaine, 7+ = date longue (ex. 15 octobre).
 */
export function formatSoaReportDayLabel(
  dayKey: string,
  dayIndex: number,
  t: (key: string) => string,
): string {
  if (dayIndex === 0) return t("dates.today");
  if (dayIndex === 1) return t("dates.yesterday");

  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  const locale = getNumberLocale(lang);
  const date = dateFromDayKey(dayKey);

  if (dayIndex >= 2 && dayIndex <= 6) {
    const weekday = date.toLocaleDateString(locale, {
      weekday: "long",
      timeZone: REPORT_TZ,
    });
    return capitalizeLabel(weekday);
  }

  const thisYear = yearInReportTz(new Date());
  const dayYear = yearInReportTz(date);
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    ...(dayYear !== thisYear ? { year: "numeric" } : {}),
    timeZone: REPORT_TZ,
  });
}

/** Index dans `soaRecentDayKeys()` pour une clé jour. */
export function dayIndexFromRecentKeys(
  dayKey: string,
  recentKeys: string[],
): number {
  const i = recentKeys.indexOf(dayKey);
  return i >= 0 ? i : 0;
}

export function formatSoaReportDayLabelForKey(
  dayKey: string,
  recentKeys: string[],
  t: (key: string) => string,
): string {
  const index = dayIndexFromRecentKeys(dayKey, recentKeys);
  return formatSoaReportDayLabel(dayKey, index, t);
}

/** Date calendaire longue (ex. 15 octobre 2025) — sous-titre discret. */
export function formatSoaReportDayConcrete(dayKey: string): string {
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  const locale = getNumberLocale(lang);
  const date = dateFromDayKey(dayKey);
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: REPORT_TZ,
  });
}
