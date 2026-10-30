import {
  dedupeSoaReportTripsByTripId,
  mergeSoaReportTripIntoMap,
} from "@/lib/soa/dedupeSoaReportTrips";
import type { SoaCarDayReport, SoaCarTripReportRow } from "@/lib/soa/soaCar";
import {
  soaCommerceDayKey,
  soaRecentDayKeys,
  soaShiftDayKey,
} from "@/lib/soa/soaDayKey";
import { getSoaDayReportSnapshot } from "@/lib/soa/soaReportCache";

const REPORT_TZ = "Africa/Douala";

export type SoaReportPeriodKind = "day" | "week" | "month";

function dateFromDayKey(dayKey: string): Date {
  return new Date(`${String(dayKey).trim()}T12:00:00+01:00`);
}

function weekdayMon0Douala(dayKey: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: REPORT_TZ,
  }).format(dateFromDayKey(dayKey));
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[wd] ?? 0;
}

/** Lundi de la semaine (Douala) contenant `dayKey`. */
export function soaWeekStartDayKey(dayKey: string): string {
  let dk = String(dayKey ?? "").trim();
  const offset = weekdayMon0Douala(dk);
  for (let i = 0; i < offset; i++) {
    dk = soaShiftDayKey(dk, -1);
  }
  return dk;
}

export function soaDayKeysForWeek(weekStartDayKey: string): string[] {
  const start = String(weekStartDayKey ?? "").trim();
  const keys: string[] = [];
  let dk = start;
  const today = soaCommerceDayKey();
  for (let i = 0; i < 7; i++) {
    if (dk > today) break;
    keys.push(dk);
    dk = soaShiftDayKey(dk, 1);
  }
  return keys;
}

export function soaRecentWeekStarts(count = 8): string[] {
  const out: string[] = [];
  let start = soaWeekStartDayKey(soaCommerceDayKey());
  for (let i = 0; i < count; i++) {
    out.push(start);
    start = soaShiftDayKey(start, -7);
  }
  return out;
}

export function soaMonthKeyFromDayKey(dayKey: string): string {
  return String(dayKey ?? "").trim().slice(0, 7);
}

function isValidDayKey(dk: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dk);
}

export function soaDayKeysInMonth(monthKey: string): string[] {
  const mk = String(monthKey ?? "").trim();
  const today = soaCommerceDayKey();
  let dk = `${mk}-01`;
  if (!isValidDayKey(dk)) return [];
  const keys: string[] = [];
  while (soaMonthKeyFromDayKey(dk) === mk) {
    if (dk > today) break;
    keys.push(dk);
    const next = soaShiftDayKey(dk, 1);
    if (soaMonthKeyFromDayKey(next) !== mk) break;
    dk = next;
  }
  return keys;
}

export function soaRecentMonthKeys(count = 6): string[] {
  const out: string[] = [];
  let mk = soaMonthKeyFromDayKey(soaCommerceDayKey());
  for (let i = 0; i < count; i++) {
    out.push(mk);
    const first = `${mk}-01`;
    mk = soaMonthKeyFromDayKey(soaShiftDayKey(first, -1));
  }
  return out;
}

export function countCompletedSoaTripsForDayKeys(
  commerceId: string,
  dayKeys: string[],
): number {
  const byTripId = new Map<string, import("@/lib/soa/soaCar").SoaCarTripReportRow>();
  for (const dk of dayKeys) {
    const snap = getSoaDayReportSnapshot(commerceId, dk);
    if (!snap) continue;
    for (const trip of snap.trips) {
      if (trip.isActive) continue;
      mergeSoaReportTripIntoMap(byTripId, trip);
    }
  }
  return byTripId.size;
}

export function sumSoaReportTotalForDayKeys(
  commerceId: string,
  dayKeys: string[],
): number | null {
  let total = 0;
  let any = false;
  for (const dk of dayKeys) {
    const snap = getSoaDayReportSnapshot(commerceId, dk);
    if (!snap) continue;
    any = true;
    total += snap.totalFcfa;
  }
  return any ? total : null;
}

export function aggregateSoaReportForDayKeys(
  commerceId: string,
  periodKey: string,
  dayKeys: string[],
): SoaCarDayReport {
  let totalFcfa = 0;
  const tripRows: SoaCarTripReportRow[] = [];
  for (const dk of dayKeys) {
    const snap = getSoaDayReportSnapshot(commerceId, dk);
    if (!snap) continue;
    totalFcfa += snap.totalFcfa;
    tripRows.push(...snap.trips);
  }
  const trips = dedupeSoaReportTripsByTripId(tripRows);
  return {
    dayKey: periodKey,
    totalFcfa,
    tripCount: trips.length,
    trips,
  };
}

/** Jours à synchroniser pour la liste déroulante ouverte (pas tout l’historique). */
export function soaReportPrefetchDayKeysForPicker(
  periodKind: SoaReportPeriodKind,
): string[] {
  if (periodKind === "day") return soaRecentDayKeys(14);
  if (periodKind === "week") {
    const set = new Set<string>();
    for (const ws of soaRecentWeekStarts(8)) {
      for (const dk of soaDayKeysForWeek(ws)) set.add(dk);
    }
    return [...set];
  }
  const set = new Set<string>();
  for (const mk of soaRecentMonthKeys(6)) {
    for (const dk of soaDayKeysInMonth(mk)) set.add(dk);
  }
  return [...set];
}
