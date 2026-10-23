import type { SoaTripSeat } from "@/lib/soa/soaCar";

export type SoaSeatAggregate = {
  seatNumber: number;
  payments: SoaTripSeat[];
  totalFcfa: number;
  paymentCount: number;
};

/** Regroupe les lignes trip par numéro de siège (plusieurs paiements possibles). */
export function buildSoaSeatAggregateMap(
  seats: SoaTripSeat[],
): Map<number, SoaSeatAggregate> {
  const bySeat = new Map<number, SoaTripSeat[]>();
  for (const row of seats) {
    const n = row.seatNumber;
    const list = bySeat.get(n) ?? [];
    list.push(row);
    bySeat.set(n, list);
  }
  const out = new Map<number, SoaSeatAggregate>();
  for (const [seatNumber, payments] of bySeat) {
    const sorted = [...payments].sort(
      (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
    );
    out.set(seatNumber, {
      seatNumber,
      payments: sorted,
      totalFcfa: sorted.reduce((sum, p) => sum + p.amountFcfa, 0),
      paymentCount: sorted.length,
    });
  }
  return out;
}
