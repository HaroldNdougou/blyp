import { fallbackAccountId } from "@/lib/accountId";
import type { ApiUser } from "@/lib/api/types";

const BLYP_PUBLIC_ID_RE = /^BLYP-[UC]-[0-9A-HJKMNP-TV-Z]{10}$/;

function normalizeBleAccountId(raw: string | null | undefined): string | null {
  const id = String(raw ?? "").trim().toUpperCase();
  if (!id) return null;
  if (BLYP_PUBLIC_ID_RE.test(id)) return id;
  /** Sessions anciennes : id = UUID interne → dériver le BLYP-U- stable (comme l’API). */
  if (/^[0-9A-F-]{36}$/.test(id)) return fallbackAccountId(id);
  return null;
}

/**
 * Compte + tel pour la pub BLE taxi / commerce.
 * Utilise le compte actif (BLYP-C- en pro, BLYP-U- en perso).
 */
export function resolveBleBroadcastAccount(user: ApiUser | null | undefined): {
  accountId: string | null;
  phone: string | null;
} {
  if (!user?.phone?.trim()) return { accountId: null, phone: null };

  let raw: string | null | undefined;
  if (user.activeContext?.type === "commerce") {
    raw = user.activeContext.accountId ?? user.id;
  } else {
    raw = user.personalAccountId ?? user.id;
  }

  return {
    accountId: normalizeBleAccountId(raw),
    phone: user.phone,
  };
}
