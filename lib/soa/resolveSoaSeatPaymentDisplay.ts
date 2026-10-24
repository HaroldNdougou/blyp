import type { TransactionItem } from "@/lib/api/types";
import { formatTransactionDate } from "@/lib/format";
import type { SoaTripSeat } from "@/lib/soa/soaCar";

export type SoaSeatPaymentDisplay = {
  payerName: string;
  payerPhone: string | null;
  paidAtLabel: string;
  seatNumber: number;
  amountFcfa: number;
};

export function indexTransactionsById(
  items: TransactionItem[] | null | undefined,
): Map<string, TransactionItem> {
  const map = new Map<string, TransactionItem>();
  for (const tx of items ?? []) {
    map.set(tx.id, tx);
  }
  return map;
}

function formatPayerPhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 9) return digits.length > 0 ? digits : null;
  const local = digits.slice(-9);
  return `${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}

export function resolveSoaSeatPaymentDisplay(
  seat: SoaTripSeat,
  txById: Map<string, TransactionItem>,
  unknownPayerLabel: string,
): SoaSeatPaymentDisplay {
  const tx = txById.get(seat.transactionId);
  const name =
    String(seat.payerName ?? "").trim() ||
    String(tx?.counterpartyName ?? "").trim() ||
    unknownPayerLabel;
  const phoneRaw =
    String(seat.payerPhone ?? "").trim() || tx?.counterpartyPhone || null;
  return {
    payerName: name,
    payerPhone: formatPayerPhone(phoneRaw),
    paidAtLabel: formatTransactionDate(seat.paidAt),
    seatNumber: seat.seatNumber,
    amountFcfa: seat.amountFcfa,
  };
}
