import type { SoaCarTripReportRow } from "@/lib/soa/soaCar";

export type SoaReportTripListItem = SoaCarTripReportRow & {
  /** 1-based index for completed trips; null for active trip. */
  courseNumber: number | null;
};

function tripChronologyMs(trip: SoaCarTripReportRow): number {
  const raw = trip.tripStartedAt || trip.endedAt || "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

/** Completed trips oldest→newest (Course 1, 2…), then active trip last. */
export function orderSoaReportTripsForList(
  trips: SoaCarTripReportRow[],
): SoaReportTripListItem[] {
  const completed = trips.filter((t) => !t.isActive);
  const active = trips.filter((t) => t.isActive);
  completed.sort((a, b) => tripChronologyMs(a) - tripChronologyMs(b));
  const numbered = completed.map((trip, i) => ({
    ...trip,
    courseNumber: i + 1,
  }));
  const activeItems = active.map((trip) => ({
    ...trip,
    courseNumber: null as number | null,
  }));
  return [...numbered, ...activeItems];
}
