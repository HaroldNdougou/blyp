import { SOA_CAR_CATEGORY, SOA_CAR_SEAT_COUNT } from "@/lib/soa/constants";

export type SoaTripSeat = {
  seatNumber: number;
  amountFcfa: number;
  paidAt: string;
  transactionId: string;
  payerName?: string | null;
  payerPhone?: string | null;
};

export type SoaCarTrip = {
  commerceId: string;
  seatCount: number;
  totalFcfa: number;
  seats: SoaTripSeat[];
  tripStartedAt: string;
};

export type SoaCarTripReportRow = {
  tripId: string;
  totalFcfa: number;
  tripStartedAt: string;
  endedAt: string | null;
  isActive: boolean;
  seats: SoaTripSeat[];
};

export type SoaCarDayReport = {
  dayKey: string;
  totalFcfa: number;
  tripCount: number;
  trips: SoaCarTripReportRow[];
};

export function isSoaCarCategory(
  category: string | null | undefined,
): boolean {
  return String(category ?? "").trim().toLowerCase() === SOA_CAR_CATEGORY;
}

export function clampSoaSeatNumber(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > SOA_CAR_SEAT_COUNT) return null;
  return n;
}
