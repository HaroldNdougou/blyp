/**
 * Résout le nom affiché d’un accountId BLE — cache d’abord, réseau après.
 * Ne bloque jamais le captage : à appeler en fire-and-forget / après paint.
 */
import {
  getPeerDisplayNameCached,
  hydratePeerDisplayName,
  rememberPeerDisplayName,
} from "@/lib/peers/displayNameCache";
import {
  getPeerCategoryCached,
  rememberPeerCategory,
} from "@/lib/peers/peerCategoryCache";
import type { SpendCategory } from "@/lib/pay/spendCategory";
import { normalizeSpendCategory } from "@/lib/pay/spendCategory";

const inflight = new Map<string, Promise<string | null>>();
const categoryInflight = new Map<string, Promise<SpendCategory | null>>();

/** Catégorie commerce (soa_car, taxi…) — cache puis GET /accounts/…/public. */
export async function resolvePeerCategory(
  accountId: string,
  token: string | null | undefined,
): Promise<SpendCategory | null> {
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  if (!id.startsWith("BLYP-")) return null;

  const cached = getPeerCategoryCached(id);
  if (cached) return cached;

  const t = String(token ?? "").trim();
  if (!t) return null;

  const existing = categoryInflight.get(id);
  if (existing) return existing;

  const job = (async () => {
    try {
      const { lookupAccountPublic } = await import("@/lib/api/client");
      const res = await lookupAccountPublic(t, id);
      const cat = normalizeSpendCategory(res?.category ?? null);
      if (cat) {
        rememberPeerCategory(id, cat);
        void import("@/lib/pay/quickAmounts").then((q) => {
          q.refreshQuickAmountsIndex();
        });
      }
      return cat;
    } catch {
      return null;
    } finally {
      categoryInflight.delete(id);
    }
  })();

  categoryInflight.set(id, job);
  return job;
}

export async function resolvePeerDisplayName(
  accountId: string,
  token: string | null | undefined,
): Promise<string | null> {
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  if (!id.startsWith("BLYP-")) return null;

  const t = String(token ?? "").trim();

  const ram = getPeerDisplayNameCached(id);
  if (ram) {
    void resolvePeerCategory(id, t);
    return ram;
  }

  const local = await hydratePeerDisplayName(id);
  if (local) {
    void resolvePeerCategory(id, t);
    return local;
  }

  if (!t) return null;

  const existing = inflight.get(id);
  if (existing) return existing;

  const job = (async () => {
    try {
      const { lookupAccountPublic } = await import("@/lib/api/client");
      const res = await lookupAccountPublic(t, id);
      const name = String(res?.displayName ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 48);
      if (name.length < 2) return null;
      rememberPeerDisplayName(id, name);
      void resolvePeerCategory(id, t);
      return name;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, job);
  return job;
}
