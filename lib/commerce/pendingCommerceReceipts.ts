import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import {
  paymentTxFingerprint,
  verifyCommercePaymentReceiptSync,
} from "@/lib/pay/paymentReceipt";

const STORE_KEY = "blyp.pendingCommerceReceipts.v1";
const MAX_ITEMS = 80;

export type PendingCommerceReceiptStatus =
  | "pending"
  | "confirmed"
  | "rejected";

export type PendingCommerceReceipt = {
  id: string;
  commerceId: string;
  recipientAccountId: string;
  amountFcfa: number;
  txFp: string;
  transactionId: string | null;
  receivedAtIso: string;
  expiresAtMs: number;
  status: PendingCommerceReceiptStatus;
  source: "ble" | "receipt";
};

let items: PendingCommerceReceipt[] = [];
let hydrateStarted = false;
const listeners = new Set<() => void>();
const seenTxIds = new Set<string>();

function dedupeKeyTx(transactionId: string): string {
  return transactionId.trim().toLowerCase();
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function getPendingCommerceReceiptsSnapshot(): PendingCommerceReceipt[] {
  return items;
}

export function subscribePendingCommerceReceipts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sumPendingCommerceReceiptsFcfa(commerceId: string): number {
  let sum = 0;
  for (const row of items) {
    if (row.commerceId !== commerceId) continue;
    if (row.status !== "pending") continue;
    sum += row.amountFcfa;
  }
  return sum;
}

function parseStored(raw: string | null): PendingCommerceReceipt[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingCommerceReceipt[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.commerceId === "string" &&
        typeof r.amountFcfa === "number",
    );
  } catch {
    return [];
  }
}

async function persist(): Promise<void> {
  try {
    const SS = await import("expo-secure-store");
    const trimmed = items.slice(0, MAX_ITEMS);
    await SS.setItemAsync(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* RAM seule */
  }
}

export function hydratePendingCommerceReceiptsOnce(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  void (async () => {
    try {
      const SS = await import("expo-secure-store");
      const raw = await SS.getItemAsync(STORE_KEY);
      items = parseStored(raw);
      for (const r of items) {
        if (r.status === "pending" && r.transactionId) {
          seenTxIds.add(dedupeKeyTx(r.transactionId));
        }
      }
      emit();
    } catch {
      /* ignore */
    }
  })();
}

function pruneExpired(now = Date.now()): void {
  let changed = false;
  items = items.map((row) => {
    if (row.status !== "pending") return row;
    if (now <= row.expiresAtMs) return row;
    changed = true;
    return { ...row, status: "rejected" as const };
  });
  if (changed) void persist();
}

export async function ingestFullPaymentReceipt(input: {
  receipt: CommercePaymentReceipt;
  commerceId: string;
}): Promise<PendingCommerceReceipt | null> {
  if (!verifyCommercePaymentReceiptSync(input.receipt)) return null;
  if (input.receipt.commerceId && input.receipt.commerceId !== input.commerceId) {
    return null;
  }
  hydratePendingCommerceReceiptsOnce();
  const txId = input.receipt.transactionId.trim();
  const key = dedupeKeyTx(txId);
  if (seenTxIds.has(key)) {
    const existing = items.find(
      (r) =>
        r.transactionId === txId &&
        r.status === "pending",
    );
    return existing ?? null;
  }
  seenTxIds.add(key);
  const txFp = paymentTxFingerprint(txId);
  const row: PendingCommerceReceipt = {
    id: `rcpt-${txId}`,
    commerceId: input.commerceId,
    recipientAccountId: input.receipt.recipientAccountId,
    amountFcfa: input.receipt.amountFcfa,
    txFp,
    transactionId: txId,
    receivedAtIso: new Date().toISOString(),
    expiresAtMs: input.receipt.expiresAt,
    status: "pending",
    source: "receipt",
  };
  items = [row, ...items.filter((r) => r.id !== row.id)].slice(0, MAX_ITEMS);
  emit();
  await persist();
  return row;
}

export async function applyPendingReceiptStatuses(
  updates: { id: string; status: PendingCommerceReceiptStatus; transactionId?: string }[],
): Promise<void> {
  if (!updates.length) return;
  const map = new Map(updates.map((u) => [u.id, u]));
  items = items.map((row) => {
    const hit = map.get(row.id);
    if (!hit) return row;
    return {
      ...row,
      status: hit.status,
      transactionId: hit.transactionId ?? row.transactionId,
    };
  });
  emit();
  await persist();
}

export function prunePendingCommerceReceipts(): void {
  pruneExpired();
}
