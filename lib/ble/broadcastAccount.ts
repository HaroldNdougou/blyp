import { fallbackAccountId } from "@/lib/accountId";
import type { ApiUser } from "@/lib/api/types";
import type { SpendCategory } from "@/lib/pay/spendCategory";
import { normalizeSpendCategory } from "@/lib/pay/spendCategory";

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
  category: SpendCategory | null;
} {
  if (!user?.phone?.trim()) {
    return { accountId: null, phone: null, category: null };
  }

  let raw: string | null | undefined;
  let category: SpendCategory | null = "taxi";
  if (user.activeContext?.type === "commerce") {
    raw = user.activeContext.accountId ?? user.id;
    const ctx = user.activeContext;
    const fromList = user.commerces?.find((c) => c.id === ctx.commerceId);
    category =
      normalizeSpendCategory(ctx.category) ??
      normalizeSpendCategory(fromList?.category) ??
      "other";
  } else {
    raw = user.personalAccountId ?? user.id;
  }

  return {
    accountId: normalizeBleAccountId(raw),
    phone: user.phone,
    category,
  };
}

/** Pay → Recevoir à proximité (perso, pas taxi / pas commerce). */
export function resolveP2pReceiveBroadcastAccount(
  user: ApiUser | null | undefined,
): {
  accountId: string | null;
  phone: string | null;
  category: SpendCategory;
} {
  if (!user?.phone?.trim()) {
    return { accountId: null, phone: null, category: "other" };
  }
  return {
    accountId: normalizeBleAccountId(user.personalAccountId ?? user.id),
    phone: user.phone,
    category: "other",
  };
}
