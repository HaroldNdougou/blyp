import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import { Platform } from "react-native";

const QUEUE_KEY = "blyp.pendingReceiptEncash.v1";
const MAX = 40;

type Row = { commerceId: string; receipt: CommercePaymentReceipt };

let queue: Row[] = [];
let hydrated = false;

async function load(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const SS = await import("expo-secure-store");
    const raw = await SS.getItemAsync(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Row[];
      if (Array.isArray(parsed)) queue = parsed.slice(0, MAX);
    }
    await pullNativeMirrorIfAny();
  } catch {
    /* ignore */
  }
}

async function save(): Promise<void> {
  try {
    const SS = await import("expo-secure-store");
    const payload = JSON.stringify(queue.slice(0, MAX));
    await SS.setItemAsync(QUEUE_KEY, payload);
    const { syncNativeShellPendingReceiptEncashQueue } = await import(
      "@/lib/nativeShell"
    );
    syncNativeShellPendingReceiptEncashQueue(payload);
  } catch {
    /* ignore */
  }
}

async function pullNativeMirrorIfAny(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const { pullNativeShellPendingReceiptEncashQueue } = await import(
      "@/lib/nativeShell"
    );
    const raw = await pullNativeShellPendingReceiptEncashQueue();
    if (!raw || raw === "[]") return;
    const parsed = JSON.parse(raw) as Row[];
    if (!Array.isArray(parsed) || !parsed.length) return;
    const merged = [...parsed];
    for (const row of queue) {
      const tx = row.receipt.transactionId.trim();
      if (merged.some((r) => r.receipt.transactionId === tx)) continue;
      merged.push(row);
    }
    queue = merged.slice(0, MAX);
  } catch {
    /* ignore */
  }
}

export async function enqueueReceiptEncash(row: Row): Promise<void> {
  await load();
  const tx = row.receipt.transactionId.trim();
  if (queue.some((r) => r.receipt.transactionId === tx)) return;
  queue = [row, ...queue].slice(0, MAX);
  await save();
}

export async function mergeNativePendingReceiptEncashFromShell(
  pull: () => Promise<string | null>,
): Promise<void> {
  const raw = await pull();
  if (!raw || raw === "[]") return;
  await load();
  try {
    const parsed = JSON.parse(raw) as Row[];
    if (!Array.isArray(parsed)) return;
    const merged = [...parsed];
    for (const row of queue) {
      const tx = row.receipt.transactionId.trim();
      if (merged.some((r) => r.receipt.transactionId === tx)) continue;
      merged.push(row);
    }
    const next = merged.slice(0, MAX);
    const same =
      next.length === queue.length &&
      next.every(
        (r, i) =>
          r.commerceId === queue[i]?.commerceId &&
          r.receipt.transactionId === queue[i]?.receipt.transactionId,
      );
    if (same) return;
    queue = next;
    await save();
  } catch {
    /* ignore */
  }
}

export async function drainPendingReceiptEncashQueue(input: {
  commerceId: string;
  token: string;
}): Promise<void> {
  await load();
  if (!queue.length) return;
  const { encashCommercePaymentReceipt } = await import("@/lib/api/client");
  const { rememberEncashedReceiptTransactionId } = await import(
    "@/lib/commerce/encashedReceiptIdsCache"
  );
  const { API_ERROR_PAYMENT_RECEIPT_ALREADY_ENCASHED, ApiError } =
    await import("@/lib/api/errors");
  const { applyPendingReceiptStatuses } = await import(
    "@/lib/commerce/pendingCommerceReceipts"
  );

  const remaining: Row[] = [];
  for (const row of queue) {
    if (row.commerceId !== input.commerceId) {
      remaining.push(row);
      continue;
    }
    try {
      await encashCommercePaymentReceipt(input.commerceId, input.token, {
        receipt: row.receipt,
      });
      await rememberEncashedReceiptTransactionId(row.receipt.transactionId);
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.status === 409 ||
          e.code === API_ERROR_PAYMENT_RECEIPT_ALREADY_ENCASHED)
      ) {
        await rememberEncashedReceiptTransactionId(row.receipt.transactionId);
        await applyPendingReceiptStatuses([
          {
            id: `rcpt-${row.receipt.transactionId}`,
            status: "rejected",
          },
        ]);
        continue;
      }
      remaining.push(row);
    }
  }
  queue = remaining;
  await save();
}
