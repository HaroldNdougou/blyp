import type { ApiUser } from "@/lib/api/types";
import { maxTxAmountFcfaForUser } from "@/lib/kyc/limits";

const STORE_KEY = "blyp.payDossier.v1";

/** Dossier pay (solde, plafonds, mode) — lu avant le réseau au clic. */
export type PayDossierSnapshot = {
  phone: string;
  balanceFcfa: number;
  needsOnboarding: boolean;
  commerceMode: boolean;
  maxTxFcfa: number;
  smallPayWithoutPinEnabled: boolean;
  smallPayStatsDay: string | null;
  smallPayStatsSumFcfa: number;
  smallPayPeriodWithoutPinSumFcfa: number;
  updatedAtMs: number;
};

let snapshot: PayDossierSnapshot | null = null;
let hydratedDisk = false;
const listeners = new Set<(snap: PayDossierSnapshot | null) => void>();

function publish(): void {
  const snap = snapshot;
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  }
}

function buildFromUser(user: ApiUser): PayDossierSnapshot {
  return {
    phone: String(user.phone ?? "").trim(),
    balanceFcfa: Math.floor(Number(user.balanceFcfa) || 0),
    needsOnboarding: Boolean(user.needsOnboarding),
    commerceMode: user.activeContext?.type === "commerce",
    maxTxFcfa: maxTxAmountFcfaForUser(user),
    smallPayWithoutPinEnabled: Boolean(user.smallPayWithoutPinEnabled),
    smallPayStatsDay: user.smallPayStatsDay ?? null,
    smallPayStatsSumFcfa: Math.floor(Number(user.smallPayStatsSumFcfa) || 0),
    smallPayPeriodWithoutPinSumFcfa: Math.floor(
      Number(user.smallPayPeriodWithoutPinSumFcfa) || 0,
    ),
    updatedAtMs: Date.now(),
  };
}

function same(a: PayDossierSnapshot | null, b: PayDossierSnapshot): boolean {
  if (!a) return false;
  return (
    a.phone === b.phone &&
    a.balanceFcfa === b.balanceFcfa &&
    a.needsOnboarding === b.needsOnboarding &&
    a.commerceMode === b.commerceMode &&
    a.maxTxFcfa === b.maxTxFcfa &&
    a.smallPayWithoutPinEnabled === b.smallPayWithoutPinEnabled &&
    a.smallPayStatsDay === b.smallPayStatsDay &&
    a.smallPayStatsSumFcfa === b.smallPayStatsSumFcfa &&
    a.smallPayPeriodWithoutPinSumFcfa === b.smallPayPeriodWithoutPinSumFcfa
  );
}

async function persist(snap: PayDossierSnapshot): Promise<void> {
  try {
    const SS = await import("expo-secure-store");
    await SS.setItemAsync(STORE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

export async function hydratePayDossierFromDisk(phone: string): Promise<void> {
  const p = String(phone ?? "").trim();
  if (!p || hydratedDisk) return;
  hydratedDisk = true;
  try {
    const SS = await import("expo-secure-store");
    const raw = await SS.getItemAsync(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PayDossierSnapshot;
    if (String(parsed?.phone ?? "").trim() !== p) return;
    if (snapshot && snapshot.updatedAtMs >= (parsed.updatedAtMs ?? 0)) return;
    snapshot = parsed;
    publish();
  } catch {
    /* ignore */
  }
}

export function hydratePayDossierFromUser(user: ApiUser | null | undefined): void {
  if (!user?.phone?.trim()) {
    snapshot = null;
    publish();
    return;
  }
  const next = buildFromUser(user);
  if (same(snapshot, next)) return;
  snapshot = next;
  hydratedDisk = true;
  publish();
  void persist(next);
}

export function getPayDossierSnapshot(): PayDossierSnapshot | null {
  return snapshot;
}

export function subscribePayDossier(
  listener: (snap: PayDossierSnapshot | null) => void,
): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function userForPayFromDossier(
  user: ApiUser | null | undefined,
): ApiUser | null {
  const d = snapshot;
  const phone = user?.phone?.trim() || d?.phone;
  if (!phone) return user ?? null;
  if (!d || d.phone !== phone) return user ?? null;

  if (!user) {
    return {
      phone: d.phone,
      id: null,
      balanceFcfa: d.balanceFcfa,
      needsOnboarding: d.needsOnboarding,
      activeContext: d.commerceMode
        ? { type: "commerce", commerceId: "", name: "", accountId: "" }
        : { type: "personal" },
      smallPayWithoutPinEnabled: d.smallPayWithoutPinEnabled,
      smallPayStatsDay: d.smallPayStatsDay,
      smallPayStatsSumFcfa: d.smallPayStatsSumFcfa,
      smallPayPeriodWithoutPinSumFcfa: d.smallPayPeriodWithoutPinSumFcfa,
      kycStatus: "none",
      firstName: null,
      lastName: null,
      onboardingStep: null,
    };
  }

  return {
    ...user,
    balanceFcfa: d.balanceFcfa,
    needsOnboarding: d.needsOnboarding,
    smallPayWithoutPinEnabled: d.smallPayWithoutPinEnabled,
    smallPayStatsDay: d.smallPayStatsDay,
    smallPayStatsSumFcfa: d.smallPayStatsSumFcfa,
    smallPayPeriodWithoutPinSumFcfa: d.smallPayPeriodWithoutPinSumFcfa,
  };
}

/** Solde affiché / règles locales après « payé » optimiste. */
export function debitPayDossierOptimistic(amountFcfa: number): number | null {
  if (!snapshot) return null;
  const amount = Math.floor(Number(amountFcfa));
  if (amount <= 0) return snapshot.balanceFcfa;
  const balanceAfterFcfa = Math.max(0, snapshot.balanceFcfa - amount);
  snapshot = {
    ...snapshot,
    balanceFcfa: balanceAfterFcfa,
    updatedAtMs: Date.now(),
  };
  publish();
  void persist(snapshot);
  return balanceAfterFcfa;
}

export function setPayDossierBalance(balanceFcfa: number): void {
  if (!snapshot) return;
  const b = Math.max(0, Math.floor(Number(balanceFcfa) || 0));
  if (snapshot.balanceFcfa === b) return;
  snapshot = { ...snapshot, balanceFcfa: b, updatedAtMs: Date.now() };
  publish();
  void persist(snapshot);
}

export async function clearPayDossierCache(): Promise<void> {
  snapshot = null;
  hydratedDisk = false;
  publish();
  try {
    const SS = await import("expo-secure-store");
    await SS.deleteItemAsync(STORE_KEY);
  } catch {
    /* ignore */
  }
}
