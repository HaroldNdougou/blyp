import type { MoneyTransfer } from "@/lib/api/types";

const overrides = new Map<string, { value: boolean; untilMs: number }>();

const TTL_MS = 12_000;

export function setMoneyReceiptOverride(
  transferId: string,
  value: boolean,
): void {
  const id = String(transferId ?? "").trim();
  if (!id) return;
  overrides.set(id, { value, untilMs: Date.now() + TTL_MS });
}

export function clearMoneyReceiptOverride(transferId: string): void {
  const id = String(transferId ?? "").trim();
  if (!id) return;
  overrides.delete(id);
}

export function applyMoneyReceiptOverride(tr: MoneyTransfer): MoneyTransfer {
  const id = String(tr.transferId ?? "").trim();
  if (!id) return tr;
  const row = overrides.get(id);
  if (!row) return tr;
  if (Date.now() > row.untilMs) {
    overrides.delete(id);
    return tr;
  }
  if (Boolean(tr.receiptRequired) === row.value) {
    overrides.delete(id);
    return tr;
  }
  return { ...tr, receiptRequired: row.value };
}
