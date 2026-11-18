import type { ApiUser } from "@/lib/api/types";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import { newPayIdempotencyKey } from "@/lib/pay/payIdempotency";

const QUEUE_KEY = "blyp.pendingInstantPay.v1";
const MAX = 12;

export type PendingInstantPayRow = {
  idempotencyKey: string;
  amountFcfa: number;
  recipientAccountId: string;
  recipientName: string;
  recipientPhone: string | null;
  smallPaySkipPin: boolean;
  soaSeatNumber: number | null;
  cashierSession: number | null;
  optimisticTxId: string;
  balanceBeforeFcfa: number;
  createdAtMs: number;
};

let queue: PendingInstantPayRow[] = [];
let hydrated = false;
const listeners = new Set<(count: number) => void>();

function publishCount(): void {
  const n = queue.length;
  for (const fn of listeners) {
    try {
      fn(n);
    } catch {
      /* ignore */
    }
  }
}

export function subscribePendingInstantPayCount(
  listener: (count: number) => void,
): () => void {
  listeners.add(listener);
  void pendingInstantPayCount().then((n) => listener(n));
  return () => {
    listeners.delete(listener);
  };
}

export function notifyPendingInstantPayChanged(): void {
  publishCount();
}

async function load(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const SS = await import("expo-secure-store");
    const raw = await SS.getItemAsync(QUEUE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PendingInstantPayRow[];
    if (Array.isArray(parsed)) queue = parsed.slice(0, MAX);
  } catch {
    /* ignore */
  }
}

async function save(): Promise<void> {
  try {
    const SS = await import("expo-secure-store");
    await SS.setItemAsync(QUEUE_KEY, JSON.stringify(queue.slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

export async function pendingInstantPayCount(): Promise<number> {
  await load();
  return queue.length;
}

export async function peekPendingInstantPay(): Promise<PendingInstantPayRow | null> {
  await load();
  return queue[0] ?? null;
}

export async function enqueuePendingInstantPay(
  row: Omit<PendingInstantPayRow, "createdAtMs">,
): Promise<void> {
  await load();
  const key = row.idempotencyKey.trim();
  if (queue.some((r) => r.idempotencyKey === key)) return;
  queue = [{ ...row, createdAtMs: Date.now() }, ...queue].slice(0, MAX);
  await save();
}

export async function shiftPendingInstantPay(
  idempotencyKey: string,
): Promise<void> {
  await load();
  const key = idempotencyKey.trim();
  const next = queue.filter((r) => r.idempotencyKey !== key);
  if (next.length === queue.length) return;
  queue = next;
  await save();
}

export async function clearPendingInstantPayQueue(): Promise<void> {
  queue = [];
  hydrated = true;
  try {
    const SS = await import("expo-secure-store");
    await SS.deleteItemAsync(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

export function buildPendingInstantPayRow(input: {
  amountFcfa: number;
  to: QuickPayRecipient;
  user: ApiUser;
  smallPaySkipPin: boolean;
  soaSeatNumber: number | null;
  cashierSession: number | null;
  optimisticTxId: string;
  idempotencyKey?: string;
}): PendingInstantPayRow {
  const idempotencyKey = input.idempotencyKey?.trim() || newPayIdempotencyKey();
  return {
    idempotencyKey,
    amountFcfa: Math.floor(input.amountFcfa),
    recipientAccountId: input.to.accountId,
    recipientName: input.to.name,
    recipientPhone: input.to.phoneDigits,
    smallPaySkipPin: input.smallPaySkipPin,
    soaSeatNumber: input.soaSeatNumber,
    cashierSession: input.cashierSession,
    optimisticTxId: input.optimisticTxId,
    balanceBeforeFcfa: Math.floor(Number(input.user.balanceFcfa) || 0),
    createdAtMs: Date.now(),
  };
}
