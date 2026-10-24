import { demoSoaPayerByIndex } from "@/lib/soa/demoSoaPayers";
import type { SoaTripSeat } from "@/lib/soa/soaCar";

const PAYMENTS_PER_TRIP_TODAY = 20;
const PAYMENTS_PER_TRIP_MIN = 8;

export function demoPaymentsCountForTrip(
  dayIndex: number,
  _tripIndex: number,
): number {
  if (dayIndex === 0) return PAYMENTS_PER_TRIP_TODAY;
  return Math.max(PAYMENTS_PER_TRIP_MIN, PAYMENTS_PER_TRIP_TODAY - dayIndex);
}

/** Paiements fictifs pour une course (20 clients nommés le jour J). */
export function buildDemoTripSeats(
  dayIndex: number,
  tripIndex: number,
  baseMs: number,
  paymentCount: number,
): SoaTripSeat[] {
  const seats: SoaTripSeat[] = [];
  for (let p = 0; p < paymentCount; p++) {
    const seatNumber = ((p + tripIndex * 2) % 18) + 1;
    const payerIdx = (p + dayIndex * 3 + tripIndex) % 20;
    const payer = demoSoaPayerByIndex(payerIdx);
    const amountFcfa = 1200 + ((p * 211 + dayIndex * 97 + tripIndex * 53) % 4800);
    const paidAt = new Date(baseMs - p * 3 * 60_000).toISOString();
    const transactionId = `demo-soa-${dayIndex}-${tripIndex}-${p}`;
    seats.push({
      seatNumber,
      amountFcfa,
      paidAt,
      transactionId,
      payerName: payer.payerName,
      payerPhone: payer.payerPhone,
    });
  }
  return seats.sort((a, b) => a.seatNumber - b.seatNumber);
}

export function buildDemoActiveTripSeats(): SoaTripSeat[] {
  const baseMs = Date.now();
  return buildDemoTripSeats(0, 9, baseMs, 12);
}
