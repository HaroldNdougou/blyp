/**
 * Proches à qui l’on envoie souvent des messages money — index RAM (comme quickAmounts).
 * Source : snapshot transactions (MONEY_SEND des 14 derniers jours), top 3 par nombre d’envois.
 * Jamais de réseau / SQLite sur Pay.
 */
import type { TransactionItem } from "@/lib/api/types";
import { demoRegularRecipients } from "@/lib/dev/demoProfiles";
import {
  getTransactionsSnapshot,
  subscribeTransactionsCache,
} from "@/lib/transactionsCache";

export type RegularRecipient = {
  /** 9 derniers chiffres. */
  phone: string;
  name: string;
  firstName: string;
  count: number;
};

const LOOKBACK_SENT = 150;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_SENDS = 2;
const MAX_RECIPIENTS = 3;

let current: readonly RegularRecipient[] = [];
let enginePhone = "";
let unsubTx: (() => void) | null = null;
const listeners = new Set<() => void>();

function digits9(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-9);
}

function firstNameOf(name: string, phone: string): string {
  const n = name.trim();
  if (!n || /^\+?\d[\d\s]*$/.test(n)) return phone;
  return n.split(/\s+/)[0] ?? n;
}

function sameList(
  a: readonly RegularRecipient[],
  b: readonly RegularRecipient[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.phone !== y.phone || x.name !== y.name || x.count !== y.count) {
      return false;
    }
  }
  return true;
}

export function rebuildRegularRecipients(
  items: TransactionItem[] | null,
  ownPhone: string,
): void {
  const mine = digits9(ownPhone);
  const byPhone = new Map<
    string,
    { name: string; count: number; lastAt: string }
  >();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  let seen = 0;
  for (const tx of items ?? []) {
    if (tx.type !== "sent" || tx.kind !== "MONEY_SEND") continue;
    if (String(tx.createdAt ?? "") < since) continue;
    seen += 1;
    if (seen > LOOKBACK_SENT) break;
    const phone = digits9(tx.counterpartyPhone);
    if (phone.length !== 9 || phone === mine) continue;
    const hit = byPhone.get(phone);
    if (hit) {
      hit.count += 1;
      continue;
    }
    byPhone.set(phone, {
      name: String(tx.counterpartyName ?? "").trim(),
      count: 1,
      lastAt: tx.createdAt,
    });
  }
  for (const demo of demoRegularRecipients()) {
    if (byPhone.has(demo.phone)) continue;
    byPhone.set(demo.phone, { name: demo.name, count: demo.count, lastAt: "" });
  }
  const next: RegularRecipient[] = [...byPhone.entries()]
    .filter(([, v]) => v.count >= MIN_SENDS)
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return String(b[1].lastAt).localeCompare(String(a[1].lastAt));
    })
    .slice(0, MAX_RECIPIENTS)
    .map(([phone, v]) => ({
      phone,
      name: v.name || phone,
      firstName: firstNameOf(v.name, phone),
      count: v.count,
    }));
  if (sameList(current, next)) return;
  current = next;
  for (const cb of listeners) cb();
}

export function getRegularRecipients(): readonly RegularRecipient[] {
  return current;
}

export function subscribeRegularRecipients(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function startRegularRecipientsEngine(phone: string): () => void {
  const p = String(phone ?? "").trim();
  if (p) {
    enginePhone = p;
    rebuildRegularRecipients(getTransactionsSnapshot(p), p);
  }
  unsubTx?.();
  unsubTx = subscribeTransactionsCache((key, items) => {
    if (key !== enginePhone) return;
    rebuildRegularRecipients(items, enginePhone);
  });
  return () => {
    unsubTx?.();
    unsubTx = null;
  };
}
