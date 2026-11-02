import type { TransactionItem } from "@/lib/api/types";
import {
  getSyncCursor,
  getTransactionsSnapshot,
  mergeTransactionsDelta,
  setSyncCursor,
  setTransactionsSnapshot,
} from "@/lib/transactionsCache";
import { fallbackTxReference } from "@/lib/txReference";
import {
  markTransactionsNetworkSyncDone,
  shouldSyncTransactions,
  type TxSyncReason,
} from "@/lib/sync/transactionsPullGate";

const BYPASS_THROTTLE: ReadonlySet<TxSyncReason> = new Set([
  "pay",
  "push",
  "context_switch",
  "commerce_create",
]);

export type { TxSyncReason };

export type SyncTransactionsOptions = {
  reason?: TxSyncReason;
};

function withReferences(items: TransactionItem[]): TransactionItem[] {
  return items
    .map((t) => {
      const amountFcfa = Math.floor(Number(t.amountFcfa));
      if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) return null;
      const createdAt = String(t.createdAt ?? "").trim();
      if (!createdAt) return null;
      const type = t.type === "received" ? "received" : "sent";
      const id =
        String(t.id ?? "").trim() ||
        String(t.reference ?? "").trim() ||
        `tx-${createdAt}-${type}-${amountFcfa}`;
      return {
        ...t,
        amountFcfa,
        createdAt,
        type,
        counterpartyName: String(t.counterpartyName ?? "").trim() || "—",
        id,
        reference: t.reference?.trim() || fallbackTxReference(id),
      };
    })
    .filter((t): t is TransactionItem => t !== null);
}

let syncInFlight: Promise<TransactionItem[]> | null = null;
let syncInFlightKey = "";

async function runNetworkSync(
  token: string,
  phone: string,
): Promise<TransactionItem[]> {
  try {
    const { listTransactions } = await import("@/lib/api/client");
    const cursor = getSyncCursor(phone);
    const cached = getTransactionsSnapshot(phone);

    if (cursor && cached && cached.length > 0) {
      const { items, cursor: nextCursor, delta } = await listTransactions(
        token,
        { since: cursor },
      );
      const normalized = withReferences(items);
      if (delta && normalized.length === 0) {
        markTransactionsNetworkSyncDone();
        return cached;
      }
      if (delta) {
        const merged = mergeTransactionsDelta(phone, normalized);
        if (nextCursor) await setSyncCursor(phone, nextCursor);
        else if (merged[0]?.createdAt) {
          await setSyncCursor(phone, merged[0].createdAt);
        }
        markTransactionsNetworkSyncDone();
        return getTransactionsSnapshot(phone) ?? merged;
      }
    }

    const { items, cursor: nextCursor } = await listTransactions(token);
    const normalized = withReferences(items);
    setTransactionsSnapshot(phone, normalized);
    if (nextCursor) await setSyncCursor(phone, nextCursor);
    else if (normalized[0]?.createdAt) {
      await setSyncCursor(phone, normalized[0].createdAt);
    }
    markTransactionsNetworkSyncDone();
    return getTransactionsSnapshot(phone) ?? normalized;
  } catch {
    return getTransactionsSnapshot(phone) ?? [];
  }
}

/**
 * Sync réseau → SQLite/RAM.
 * Gate + une seule sync à la fois (sauf raisons `pay` / `push` / … qui bypass le throttle).
 */
export async function syncTransactionsFromNetwork(
  token: string,
  phone: string,
  opts?: SyncTransactionsOptions,
): Promise<TransactionItem[]> {
  const reason: TxSyncReason = opts?.reason ?? "boot";
  const cached = getTransactionsSnapshot(phone) ?? [];

  if (!shouldSyncTransactions(reason)) {
    return cached;
  }

  if (BYPASS_THROTTLE.has(reason)) {
    return runNetworkSync(token, phone);
  }

  const key = `${phone}:${token.slice(0, 8)}`;
  if (syncInFlight && syncInFlightKey === key) {
    return syncInFlight;
  }

  syncInFlightKey = key;
  syncInFlight = runNetworkSync(token, phone).finally(() => {
    if (syncInFlightKey === key) {
      syncInFlight = null;
      syncInFlightKey = "";
    }
  });
  return syncInFlight;
}
