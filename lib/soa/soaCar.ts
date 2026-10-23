import { SOA_CAR_CATEGORY, SOA_CAR_SEAT_COUNT } from "@/lib/soa/constants";

export type SoaTripSeat = {
  seatNumber: number;
  amountFcfa: number;
  paidAt: string;
  transactionId: string;
};

export type SoaCarTrip = {
  commerceId: string;
  seatCount: number;
  totalFcfa: number;
  seats: SoaTripSeat[];
  tripStartedAt: string;
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
