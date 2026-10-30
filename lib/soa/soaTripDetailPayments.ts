import type { SoaTripSeat } from "@/lib/soa/soaCar";
import {
  indexTransactionsById,
  resolveSoaSeatPaymentDisplay,
  type SoaSeatPaymentDisplay,
} from "@/lib/soa/resolveSoaSeatPaymentDisplay";
import type { TransactionItem } from "@/lib/api/types";

function seatsNeedTxLookup(seats: SoaTripSeat[]): boolean {
  for (const s of seats) {
    if (!String(s.payerName ?? "").trim()) return true;
  }
  return false;
}

export function buildSoaTripPaymentDisplays(
  seats: SoaTripSeat[],
  unknownPayerLabel: string,
  txItems: TransactionItem[] | null | undefined,
): SoaSeatPaymentDisplay[] {
  const txById = seatsNeedTxLookup(seats)
    ? indexTransactionsById(txItems)
    : new Map();
  return [...seats]
    .sort(
      (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
    )
    .map((seat) =>
      resolveSoaSeatPaymentDisplay(seat, txById, unknownPayerLabel),
    );
}
