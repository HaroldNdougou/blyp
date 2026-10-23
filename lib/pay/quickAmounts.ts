/**
 * Puces montants rapides — index RAM, jamais de SQLite / réseau sur Pay.
 * Tri : fréquence desc, puis montant desc. Repli = défauts.
 */
import type { TransactionItem } from "@/lib/api/types";
import type { SpendCategory } from "@/lib/pay/spendCategory";
import { getCategoryByPhoneCached } from "@/lib/peers/peerCategoryCache";
import {
  getTransactionsSnapshot,
  subscribeTransactionsCache,
} from "@/lib/transactionsCache";

export const DEFAULT_QUICK_AMOUNTS = [100, 350, 500, 600] as const;
/** Car UY2 Soa — 1re puce toujours 350 FCFA. */
export const SOA_CAR_FIRST_QUICK_AMOUNT = 350;
const SOA_CAR_FILL_AMOUNTS = [500, 600, 100] as const;
const LOOKBACK_SENT = 100;
const CHIP_COUNT = 4;

function withFirstQuickAmount(amounts: number[], first: number): number[] {
  const out: number[] = [first];
  for (const a of amounts) {
    if (a === first) continue;
    if (out.length >= CHIP_COUNT) break;
    out.push(a);
  }
  const fill =
    first === SOA_CAR_FIRST_QUICK_AMOUNT
      ? SOA_CAR_FILL_AMOUNTS
      : DEFAULT_QUICK_AMOUNTS;
  for (const d of fill) {
    if (out.length >= CHIP_COUNT) break;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

type Counts = Map<number, number>;

let globalCounts: Counts = new Map();
const byCategory = new Map<SpendCategory, Counts>();
const memoized = new Map<string, number[]>();
const listeners = new Set<() => void>();
let enginePhone = "";
let unsubTx: (() => void) | null = null;

function bump(map: Counts, amount: number): void {
  map.set(amount, (map.get(amount) ?? 0) + 1);
}

function rank(counts: Counts): number[] {
  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });
  const out: number[] = [];
  for (const [amt] of ranked) {
    if (out.length >= CHIP_COUNT) break;
    out.push(amt);
  }
  for (const d of DEFAULT_QUICK_AMOUNTS) {
    if (out.length >= CHIP_COUNT) break;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

function emit(): void {
  memoized.clear();
  for (const cb of listeners) cb();
}

function categoryForTx(tx: TransactionItem): SpendCategory | null {
  return getCategoryByPhoneCached(tx.counterpartyPhone ?? "");
}

export function rebuildQuickAmounts(items: TransactionItem[] | null): void {
  globalCounts = new Map();
  byCategory.clear();
  if (!items?.length) {
    emit();
    return;
  }
  let seen = 0;
  for (const tx of items) {
    if (tx.type !== "sent") continue;
    const amt = Math.floor(Number(tx.amountFcfa) || 0);
    if (amt <= 0) continue;
    bump(globalCounts, amt);
    const cat = categoryForTx(tx);
    if (cat) {
      let m = byCategory.get(cat);
      if (!m) {
        m = new Map();
        byCategory.set(cat, m);
      }
      bump(m, amt);
    }
    seen += 1;
    if (seen >= LOOKBACK_SENT) break;
  }
  emit();
}

export function noteQuickSpend(
  amountFcfa: number,
  category: SpendCategory | null,
): void {
  const amt = Math.floor(Number(amountFcfa) || 0);
  if (amt <= 0) return;
  bump(globalCounts, amt);
  if (category) {
    let m = byCategory.get(category);
    if (!m) {
      m = new Map();
      byCategory.set(category, m);
    }
    bump(m, amt);
  }
  emit();
}

export function getQuickAmounts(
  category: SpendCategory | null,
): readonly number[] {
  const key = category ?? "global";
  const hit = memoized.get(key);
  if (hit) return hit;
  let next: number[];
  if (category) {
    const scoped = byCategory.get(category);
    if (scoped && scoped.size > 0) next = rank(scoped);
    else if (globalCounts.size > 0) next = rank(globalCounts);
    else next = [...DEFAULT_QUICK_AMOUNTS];
  } else if (globalCounts.size > 0) {
    next = rank(globalCounts);
  } else {
    next = [...DEFAULT_QUICK_AMOUNTS];
  }
  if (category === "soa_car") {
    next = withFirstQuickAmount(next, SOA_CAR_FIRST_QUICK_AMOUNT);
  }
  memoized.set(key, next);
  return next;
}

export function subscribeQuickAmounts(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Démarre l’index pour un téléphone — snapshot RAM + delta. */
export function refreshQuickAmountsIndex(): void {
  if (!enginePhone) return;
  rebuildQuickAmounts(getTransactionsSnapshot(enginePhone));
}

export function startQuickAmountsEngine(phone: string): () => void {
  const p = String(phone ?? "").trim();
  if (p) {
    enginePhone = p;
    rebuildQuickAmounts(getTransactionsSnapshot(p));
  }
  unsubTx?.();
  unsubTx = subscribeTransactionsCache((key, items) => {
    if (key !== enginePhone) return;
    rebuildQuickAmounts(items);
  });
  return () => {
    unsubTx?.();
    unsubTx = null;
  };
}
