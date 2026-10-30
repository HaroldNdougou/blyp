import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";
import { soaCommerceDayKey } from "@/lib/soa/soaDayKey";
import {
  soaMonthKeyFromDayKey,
  soaWeekStartDayKey,
} from "@/lib/soa/soaReportPeriod";

const REPORT_TZ = "Africa/Douala";

function locale(): string {
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  return getNumberLocale(lang);
}

function dateFromDayKey(dayKey: string): Date {
  return new Date(`${String(dayKey).trim()}T12:00:00+01:00`);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

export function formatSoaReportWeekLabel(
  weekStartDayKey: string,
  weekIndex: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (weekIndex === 0) return t("soaCar.reportWeekThis");
  const start = dateFromDayKey(weekStartDayKey);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const loc = locale();
  const startLabel = start.toLocaleDateString(loc, {
    day: "numeric",
    month: "short",
    timeZone: REPORT_TZ,
  });
  const endLabel = end.toLocaleDateString(loc, {
    day: "numeric",
    month: "short",
    timeZone: REPORT_TZ,
  });
  return t("soaCar.reportWeekRange", { start: startLabel, end: endLabel });
}

export function formatSoaReportWeekPickerLabel(
  weekStartDayKey: string,
  weekIndex: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return formatSoaReportWeekLabel(weekStartDayKey, weekIndex, t);
}

export function formatSoaReportMonthLabel(
  monthKey: string,
  monthIndex: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const loc = locale();
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 15, 12, 0, 0));
  const long = d.toLocaleDateString(loc, {
    month: "long",
    year: "numeric",
    timeZone: REPORT_TZ,
  });
  if (monthIndex === 0) {
    return `${t("soaCar.reportMonthThis")} · ${capitalize(long)}`;
  }
  return capitalize(long);
}

export function formatSoaReportMonthPickerLabel(
  monthKey: string,
  monthIndex: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const loc = locale();
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 15, 12, 0, 0));
  if (monthIndex === 0) return t("soaCar.reportMonthThis");
  return capitalize(
    d.toLocaleDateString(loc, {
      month: "long",
      year: "numeric",
      timeZone: REPORT_TZ,
    }),
  );
}

export function isCurrentWeekStart(weekStartDayKey: string): boolean {
  return (
    soaWeekStartDayKey(soaCommerceDayKey()) ===
    String(weekStartDayKey ?? "").trim()
  );
}

export function isCurrentMonthKey(monthKey: string): boolean {
  return soaMonthKeyFromDayKey(soaCommerceDayKey()) === String(monthKey ?? "").trim();
}
