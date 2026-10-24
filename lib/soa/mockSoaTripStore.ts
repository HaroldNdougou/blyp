import {
  buildDemoSoaArchivedTrips,
  demoSoaDayReportFromArchives,
} from "@/lib/soa/demoSoaTripSeed";
import { buildDemoActiveTripSeats } from "@/lib/soa/buildDemoTripSeats";
import type { SoaCarDayReport, SoaCarTrip, SoaCarTripReportRow } from "@/lib/soa/soaCar";
import { SOA_CAR_SEAT_COUNT } from "@/lib/soa/constants";
import { soaCommerceDayKey } from "@/lib/soa/soaDayKey";

const trips = new Map<string, SoaCarTrip>();
const archives = new Map<string, SoaCarTripReportRow[]>();
const demoSeedVersionByCommerce = new Map<string, number>();
const DEMO_MOCK_SEED_VERSION = 2;

function ensureDemoSoaArchives(commerceId: string): void {
  const id = String(commerceId ?? "").trim();
  if (!id) return;
  if (demoSeedVersionByCommerce.get(id) === DEMO_MOCK_SEED_VERSION) return;
  demoSeedVersionByCommerce.set(id, DEMO_MOCK_SEED_VERSION);
  archives.set(id, buildDemoSoaArchivedTrips());
  const today = mockGetSoaTrip(id);
  const seats = buildDemoActiveTripSeats();
  const totalFcfa = seats.reduce((s, x) => s + x.amountFcfa, 0);
  trips.set(id, {
    ...today,
    totalFcfa,
    tripStartedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    seats,
  });
}

function emptyTrip(commerceId: string): SoaCarTrip {
  return {
    commerceId,
    seatCount: SOA_CAR_SEAT_COUNT,
    totalFcfa: 0,
    seats: [],
    tripStartedAt: new Date().toISOString(),
  };
}

function archiveList(commerceId: string): SoaCarTripReportRow[] {
  const id = String(commerceId ?? "").trim();
  let list = archives.get(id);
  if (!list) {
    list = [];
    archives.set(id, list);
  }
  return list;
}

function pushArchive(commerceId: string, trip: SoaCarTrip): void {
  if (trip.seats.length === 0 || trip.totalFcfa <= 0) return;
  const endedAt = new Date().toISOString();
  const row: SoaCarTripReportRow = {
    tripId: `arch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    totalFcfa: trip.totalFcfa,
    tripStartedAt: trip.tripStartedAt,
    endedAt,
    isActive: false,
    seats: [...trip.seats],
  };
  archiveList(commerceId).unshift(row);
}

export function mockGetSoaTrip(commerceId: string): SoaCarTrip {
  const id = String(commerceId ?? "").trim();
  return trips.get(id) ?? emptyTrip(id);
}

export function mockResetSoaTrip(commerceId: string): SoaCarTrip {
  const id = String(commerceId ?? "").trim();
  const prev = mockGetSoaTrip(id);
  pushArchive(id, prev);
  const trip = emptyTrip(id);
  trips.set(id, trip);
  return trip;
}

export function mockRecordSoaSeat(
  commerceId: string,
  seatNumber: number,
  amountFcfa: number,
  transactionId: string,
): { trip?: SoaCarTrip; error?: string } {
  const id = String(commerceId ?? "").trim();
  const seat = Math.floor(Number(seatNumber));
  if (!Number.isFinite(seat) || seat < 1 || seat > SOA_CAR_SEAT_COUNT) {
    return { error: "SEAT_INVALID" };
  }
  const trip = mockGetSoaTrip(id);
  const now = new Date().toISOString();
  const seats = [
    ...trip.seats,
    {
      seatNumber: seat,
      amountFcfa: Math.floor(Number(amountFcfa) || 0),
      paidAt: now,
      transactionId: String(transactionId),
    },
  ].sort((a, b) => a.seatNumber - b.seatNumber);
  const totalFcfa = seats.reduce((sum, s) => sum + s.amountFcfa, 0);
  const next: SoaCarTrip = {
    ...trip,
    seats,
    totalFcfa,
  };
  trips.set(id, next);
  return { trip: next };
}

export function mockSoaDayReport(
  commerceId: string,
  dayKey: string,
): SoaCarDayReport {
  const id = String(commerceId ?? "").trim();
  const dk = String(dayKey ?? "").trim();
  ensureDemoSoaArchives(id);
  const today = soaCommerceDayKey();
  const active = mockGetSoaTrip(id);
  const activeRow: SoaCarTripReportRow | null =
    dk === today
      ? {
          tripId: "active",
          totalFcfa: active.totalFcfa,
          tripStartedAt: active.tripStartedAt,
          endedAt: null,
          isActive: true,
          seats: [...active.seats],
        }
      : null;
  return demoSoaDayReportFromArchives(dk, archiveList(id), activeRow);
}
