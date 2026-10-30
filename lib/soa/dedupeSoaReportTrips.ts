import type { SoaCarTripReportRow } from "@/lib/soa/soaCar";

function tripDedupeScore(t: SoaCarTripReportRow): number {
  return (t.seats?.length ?? 0) * 1_000_000 + (t.totalFcfa ?? 0);
}

export function mergeSoaReportTripIntoMap(
  map: Map<string, SoaCarTripReportRow>,
  trip: SoaCarTripReportRow,
): void {
  const id = trip.isActive ? "active" : String(trip.tripId ?? "").trim();
  if (!id) return;
  const prev = map.get(id);
  if (!prev || tripDedupeScore(trip) > tripDedupeScore(prev)) {
    map.set(id, trip);
  }
}

/** Garde une ligne par tripId (archives démo ré-insérées avec un autre SK). */
export function dedupeSoaReportTripsByTripId(
  trips: SoaCarTripReportRow[],
): SoaCarTripReportRow[] {
  const map = new Map<string, SoaCarTripReportRow>();
  for (const trip of trips) {
    mergeSoaReportTripIntoMap(map, trip);
  }
  return [...map.values()];
}
