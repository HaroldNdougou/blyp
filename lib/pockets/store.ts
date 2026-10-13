/**
 * Poches — snapshot RAM (cache-first) + SQLite `kv_cache` ; réseau confirme après.
 * Les mouvements sont optimistes : solde poche + disponible bougent au clic.
 */
import { useSyncExternalStore } from "react";
import type { Pocket, PocketTransaction } from "@/lib/api/types";
import { getDb, runDbWrite } from "@/lib/db/sqlite";

export const SAVINGS_POCKET_ID = "savings";

const EMPTY: Pocket[] = [];
const EMPTY_TX: PocketTransaction[] = [];

const pocketsByPhone = new Map<string, Pocket[]>();
const txByKey = new Map<string, PocketTransaction[]>();
const hydrated = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function txKey(phone: string, pocketId: string) {
  return `${phone}|${pocketId}`;
}

function persist(phone: string, key: string, value: unknown) {
  void runDbWrite((db) =>
    db.runAsync(
      `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
      phone,
      key,
      JSON.stringify(value),
    ),
  ).catch(() => {});
}

function sortPockets(list: Pocket[]): Pocket[] {
  return [...list].sort((a, b) => {
    if (a.kind === "savings" && b.kind !== "savings") return -1;
    if (b.kind === "savings" && a.kind !== "savings") return 1;
    return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
  });
}

function samePockets(a: Pocket[], b: Pocket[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.balanceFcfa !== y.balanceFcfa ||
      x.kind !== y.kind
    ) {
      return false;
    }
  }
  return true;
}

export function getPocketsSnapshot(phone: string): Pocket[] {
  return pocketsByPhone.get(phone) ?? EMPTY;
}

export function setPocketsSnapshot(phone: string, list: Pocket[]) {
  if (!phone) return;
  const next = sortPockets(list);
  const prev = pocketsByPhone.get(phone);
  if (prev && samePockets(prev, next)) return;
  pocketsByPhone.set(phone, next);
  persist(phone, "pockets", next);
  emit();
}

export function upsertPocket(phone: string, pocket: Pocket) {
  const list = getPocketsSnapshot(phone);
  const idx = list.findIndex((p) => p.id === pocket.id);
  const next =
    idx >= 0
      ? list.map((p, i) => (i === idx ? pocket : p))
      : [...list, pocket];
  setPocketsSnapshot(phone, next);
}

export function removePocketLocal(phone: string, pocketId: string) {
  setPocketsSnapshot(
    phone,
    getPocketsSnapshot(phone).filter((p) => p.id !== pocketId),
  );
}

export function pocketsTotalFcfa(list: Pocket[]): number {
  let s = 0;
  for (const p of list) s += p.balanceFcfa;
  return s;
}

/** L’épargne existe toujours côté UI, même avant son 1er versement. */
export function savingsPocketOf(list: Pocket[]): Pocket {
  return (
    list.find((p) => p.id === SAVINGS_POCKET_ID) ?? {
      id: SAVINGS_POCKET_ID,
      name: "",
      kind: "savings",
      balanceFcfa: 0,
      createdAt: null,
      updatedAt: null,
    }
  );
}

export function getPocketTxSnapshot(phone: string, pocketId: string) {
  return txByKey.get(txKey(phone, pocketId)) ?? null;
}

export function setPocketTxSnapshot(
  phone: string,
  pocketId: string,
  items: PocketTransaction[],
) {
  const k = txKey(phone, pocketId);
  txByKey.set(k, items);
  persist(phone, `ptx:${pocketId}`, items.slice(0, 100));
  emit();
}

export function prependPocketTx(phone: string, tx: PocketTransaction) {
  const cur = getPocketTxSnapshot(phone, tx.pocketId) ?? [];
  setPocketTxSnapshot(phone, tx.pocketId, [
    tx,
    ...cur.filter((t) => t.id !== tx.id),
  ]);
}

export function replacePocketTx(
  phone: string,
  pocketId: string,
  tempId: string,
  tx: PocketTransaction | null,
) {
  const cur = getPocketTxSnapshot(phone, pocketId) ?? [];
  const next = tx
    ? cur.map((t) => (t.id === tempId ? tx : t))
    : cur.filter((t) => t.id !== tempId);
  setPocketTxSnapshot(phone, pocketId, next);
}

export async function hydratePockets(phone: string): Promise<void> {
  if (!phone || hydrated.has(phone)) return;
  hydrated.add(phone);
  try {
    const db = await getDb();
    if (!db) return;
    const rows = await db.getAllAsync<{ key: string; json: string }>(
      `SELECT key, json FROM kv_cache WHERE phone = ? AND (key = 'pockets' OR key LIKE 'ptx:%')`,
      phone,
    );
    let changed = false;
    for (const r of rows) {
      try {
        const v = JSON.parse(r.json);
        if (r.key === "pockets") {
          if (!pocketsByPhone.has(phone) && Array.isArray(v)) {
            pocketsByPhone.set(phone, sortPockets(v as Pocket[]));
            changed = true;
          }
        } else {
          const id = r.key.slice(4);
          const k = txKey(phone, id);
          if (!txByKey.has(k) && Array.isArray(v)) {
            txByKey.set(k, v as PocketTransaction[]);
            changed = true;
          }
        }
      } catch {
        /* ligne corrompue */
      }
    }
    if (changed) emit();
  } catch {
    /* best effort */
  }
}

export async function syncPocketsFromNetwork(
  token: string,
  phone: string,
): Promise<void> {
  const api = await import("@/lib/api/client");
  const { items } = await api.listPockets(token);
  setPocketsSnapshot(phone, items ?? []);
}

export async function syncPocketTxFromNetwork(
  token: string,
  phone: string,
  pocketId: string,
): Promise<void> {
  const api = await import("@/lib/api/client");
  const { items } = await api.listPocketTransactions(token, pocketId);
  const pending = (getPocketTxSnapshot(phone, pocketId) ?? []).filter((t) =>
    t.id.startsWith("tmp-"),
  );
  setPocketTxSnapshot(phone, pocketId, [...pending, ...(items ?? [])]);
}

export function usePockets(phone: string | null | undefined): Pocket[] {
  return useSyncExternalStore(
    subscribe,
    () => (phone ? getPocketsSnapshot(phone) : EMPTY),
    () => EMPTY,
  );
}

export function usePocketTx(
  phone: string | null | undefined,
  pocketId: string,
): PocketTransaction[] {
  return useSyncExternalStore(
    subscribe,
    () => (phone ? (getPocketTxSnapshot(phone, pocketId) ?? EMPTY_TX) : EMPTY_TX),
    () => EMPTY_TX,
  );
}

export function clearPocketsCache() {
  pocketsByPhone.clear();
  txByKey.clear();
  hydrated.clear();
  emit();
}
