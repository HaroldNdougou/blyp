/**
 * Mode caisse sans connexion — lié à un commerce (pas de secret, pas de PIN).
 * Persisté pour survivre au kill app ; invalidé si autre commerce ou désactivation explicite.
 */

const STORE_KEY = "blyp.offlineCashier.v1";

export type OfflineCashierModeSnapshot = {
  active: boolean;
  commerceId: string | null;
  enabledAtIso: string | null;
};

let snapshot: OfflineCashierModeSnapshot = {
  active: false,
  commerceId: null,
  enabledAtIso: null,
};

let hydrateStarted = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function parseStored(raw: string | null): OfflineCashierModeSnapshot {
  if (!raw) {
    return { active: false, commerceId: null, enabledAtIso: null };
  }
  try {
    const o = JSON.parse(raw) as {
      commerceId?: string;
      enabledAtIso?: string;
    };
    const commerceId =
      typeof o.commerceId === "string" && o.commerceId.trim()
        ? o.commerceId.trim()
        : null;
    if (!commerceId) {
      return { active: false, commerceId: null, enabledAtIso: null };
    }
    const enabledAtIso =
      typeof o.enabledAtIso === "string" ? o.enabledAtIso : null;
    return { active: true, commerceId, enabledAtIso };
  } catch {
    return { active: false, commerceId: null, enabledAtIso: null };
  }
}

async function persist(next: OfflineCashierModeSnapshot): Promise<void> {
  try {
    const SS = await import("expo-secure-store");
    if (!next.active || !next.commerceId) {
      await SS.deleteItemAsync(STORE_KEY);
      return;
    }
    await SS.setItemAsync(
      STORE_KEY,
      JSON.stringify({
        commerceId: next.commerceId,
        enabledAtIso: next.enabledAtIso,
      }),
    );
  } catch {
    /* RAM seule si SecureStore indisponible */
  }
}

export function getOfflineCashierModeSnapshot(): OfflineCashierModeSnapshot {
  return snapshot;
}

export function isOfflineCashierActiveForCommerce(
  commerceId: string | null | undefined,
): boolean {
  if (!commerceId || !snapshot.active) return false;
  return snapshot.commerceId === commerceId;
}

export function subscribeOfflineCashierMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hydrateOfflineCashierModeOnce(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  void (async () => {
    try {
      const SS = await import("expo-secure-store");
      const raw = await SS.getItemAsync(STORE_KEY);
      snapshot = parseStored(raw);
      emit();
    } catch {
      /* ignore */
    }
  })();
}

export async function enableOfflineCashierMode(
  commerceId: string,
): Promise<void> {
  const id = commerceId.trim();
  if (!id) return;
  snapshot = {
    active: true,
    commerceId: id,
    enabledAtIso: new Date().toISOString(),
  };
  emit();
  await persist(snapshot);
}

export async function disableOfflineCashierMode(): Promise<void> {
  snapshot = { active: false, commerceId: null, enabledAtIso: null };
  emit();
  await persist(snapshot);
}

/** Sync silencieuse après retour réseau (pas d’alerte UI). */
export async function runOfflineCashierBackgroundSync(input: {
  token: string;
  phone: string;
  commerceId: string;
  refreshUser: () => Promise<void>;
}): Promise<void> {
  const { token, phone, commerceId, refreshUser } = input;
  if (!token || !phone) return;
  await import("@/lib/sync/transactionsSync").then((m) =>
    m.syncTransactionsFromNetwork(token, phone, {
      reason: "commerce_focus",
    }),
  );
  const { getTransactionsSnapshot } = await import("@/lib/transactionsCache");
  const { reconcilePendingCommerceReceipts } = await import(
    "@/lib/commerce/reconcilePendingCommerceReceipts"
  );
  await reconcilePendingCommerceReceipts({
    commerceId,
    transactions: getTransactionsSnapshot(phone),
  });
  await refreshUser().catch(() => {});
}
