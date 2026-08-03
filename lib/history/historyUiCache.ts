/**
 * Lignes Historique préformatées en RAM (modèle WhatsApp).
 * Le focus onglet ne recalcule pas formatFcfa / dates si le snapshot tx est inchangé.
 */
import type { TransactionItem } from "@/lib/api/types";
import { formatTransactionDate } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";

export type HistoryUiRow = {
  id: string;
  name: string;
  amountFcfa: number;
  amountLabel: string;
  dateLabel: string;
  createdAt: string;
  reference: string;
  type: "sent" | "received";
  phone: string | null;
};

type UiPack = {
  source: TransactionItem[];
  rows: HistoryUiRow[];
};

const byPhone = new Map<string, UiPack>();

export function txItemsToHistoryRows(items: TransactionItem[]): HistoryUiRow[] {
  return items.map((t) => ({
    id: t.id,
    name: t.counterpartyName,
    amountFcfa: t.amountFcfa,
    amountLabel: formatFcfa(t.amountFcfa),
    dateLabel: formatTransactionDate(t.createdAt),
    createdAt: t.createdAt,
    reference: t.reference ?? "",
    type: t.type,
    phone: t.counterpartyPhone,
  }));
}

/** Appeler à chaque écriture du snapshot tx (même ref source = no-op). */
export function rememberHistoryUi(
  phone: string,
  items: TransactionItem[],
): HistoryUiRow[] {
  if (!phone) return [];
  const prev = byPhone.get(phone);
  if (prev && prev.source === items) return prev.rows;
  const rows = txItemsToHistoryRows(items);
  byPhone.set(phone, { source: items, rows });
  return rows;
}

export function getHistoryUiRows(phone: string): HistoryUiRow[] | null {
  if (!phone) return null;
  return byPhone.get(phone)?.rows ?? null;
}

/** Si RAM tx existe mais UI pas encore bâtie (hydrate), construit une fois. */
export function ensureHistoryUiRows(
  phone: string,
  items: TransactionItem[] | null,
): HistoryUiRow[] | null {
  if (!phone || !items) return null;
  return rememberHistoryUi(phone, items);
}

export function clearHistoryUiCache(phone?: string): void {
  if (phone) byPhone.delete(phone);
  else byPhone.clear();
}
