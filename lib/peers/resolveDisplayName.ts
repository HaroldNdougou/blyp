/**
 * Résout le nom affiché d’un accountId BLE — cache d’abord, réseau après.
 * Ne bloque jamais le captage : à appeler en fire-and-forget / après paint.
 */
import {
  getPeerAvatarUrlCached,
  rememberPeerAvatarUrl,
} from "@/lib/peers/peerAvatarCache";
import {
  getPeerDisplayNameCached,
  hydratePeerDisplayName,
  rememberPeerDisplayName,
} from "@/lib/peers/displayNameCache";
import { peerAvatarUrl } from "@/lib/peers/peerAvatarUrl";
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

const avatarInflight = new Map<string, Promise<string | null>>();

/** URL photo profil (CDN absolu depuis l’API ou repli téléphone). */
export async function resolvePeerAvatarUrl(
  accountId: string,
  token: string | null | undefined,
  phoneDigits?: string | null,
): Promise<string | null> {
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  if (!id.startsWith("BLYP-")) {
    return peerAvatarUrl(phoneDigits);
  }

  const cached = getPeerAvatarUrlCached(id);
  if (cached) return cached;

  const fromPhone = peerAvatarUrl(phoneDigits);
  if (fromPhone) return fromPhone;

  const t = String(token ?? "").trim();
  if (!t) return null;

  const existing = avatarInflight.get(id);
  if (existing) return existing;

  const job = (async () => {
    try {
      const { lookupAccountPublic } = await import("@/lib/api/client");
      const res = await lookupAccountPublic(t, id);
      const url = String(
        (res as { avatarUrl?: string | null }).avatarUrl ?? "",
      ).trim();
      if (url) {
        rememberPeerAvatarUrl(id, url);
        return url;
      }
      return null;
    } catch {
      return null;
    } finally {
      avatarInflight.delete(id);
    }
  })();

  avatarInflight.set(id, job);
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
      const avatarUrl = String(
        (res as { avatarUrl?: string | null }).avatarUrl ?? "",
      ).trim();
      if (avatarUrl) rememberPeerAvatarUrl(id, avatarUrl);
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
