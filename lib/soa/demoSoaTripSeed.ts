import {
  buildDemoTripSeats,
  demoPaymentsCountForTrip,
} from "@/lib/soa/buildDemoTripSeats";
import type { SoaCarTripReportRow } from "@/lib/soa/soaCar";
import { soaCommerceDayKey, soaRecentDayKeys } from "@/lib/soa/soaDayKey";

/** Courses fictives sur les 14 derniers jours (compte rendu Soa). */
export function buildDemoSoaArchivedTrips(): SoaCarTripReportRow[] {
  const rows: SoaCarTripReportRow[] = [];
  const dayKeys = soaRecentDayKeys(14);
  for (let dayIndex = 0; dayIndex < dayKeys.length; dayIndex++) {
    const tripCount = dayIndex % 4 === 0 ? 3 : dayIndex % 2 === 0 ? 2 : 1;
    for (let t = 0; t < tripCount; t++) {
      const baseMs = Date.now() - dayIndex * 24 * 60 * 60 * 1000 - t * 52 * 60 * 1000;
      const endedAt = new Date(baseMs).toISOString();
      const startedAt = new Date(baseMs - 38 * 60 * 1000).toISOString();
      const paymentCount = demoPaymentsCountForTrip(dayIndex, t);
      const seats = buildDemoTripSeats(dayIndex, t, baseMs, paymentCount);
      const totalFcfa = seats.reduce((s, x) => s + x.amountFcfa, 0);
      rows.push({
        tripId: `demo-arch-${dayIndex}-${t}`,
        totalFcfa,
        tripStartedAt: startedAt,
        endedAt,
        isActive: false,
        seats,
      });
    }
  }
  return rows;
}

export function demoSoaDayReportFromArchives(
  dayKey: string,
  archives: SoaCarTripReportRow[],
  activeToday: SoaCarTripReportRow | null,
): import("@/lib/soa/soaCar").SoaCarDayReport {
  const dk = String(dayKey ?? "").trim();
  const trips = archives.filter(
    (t) => t.endedAt && soaCommerceDayKey(new Date(t.endedAt)) === dk,
  );
  const out = [...trips];
  const today = soaCommerceDayKey();
  if (dk === today && activeToday) {
    out.unshift(activeToday);
  }
  out.sort(
    (a, b) =>
      Date.parse(b.tripStartedAt || b.endedAt || 0) -
      Date.parse(a.tripStartedAt || a.endedAt || 0),
  );
  const totalFcfa = out.reduce((s, t) => s + t.totalFcfa, 0);
  return {
    dayKey: dk,
    totalFcfa,
    tripCount: out.length,
    trips: out,
  };
}
