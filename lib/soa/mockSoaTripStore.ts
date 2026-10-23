import type { SoaCarTrip } from "@/lib/soa/soaCar";
import { SOA_CAR_SEAT_COUNT } from "@/lib/soa/constants";

const trips = new Map<string, SoaCarTrip>();

function emptyTrip(commerceId: string): SoaCarTrip {
  return {
    commerceId,
    seatCount: SOA_CAR_SEAT_COUNT,
    totalFcfa: 0,
    seats: [],
    tripStartedAt: new Date().toISOString(),
  };
}

export function mockGetSoaTrip(commerceId: string): SoaCarTrip {
  const id = String(commerceId ?? "").trim();
  return trips.get(id) ?? emptyTrip(id);
}

export function mockResetSoaTrip(commerceId: string): SoaCarTrip {
  const id = String(commerceId ?? "").trim();
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
