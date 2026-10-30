import * as SecureStore from "expo-secure-store";

const KEY = "blyp_taxi_broadcast_want_v1";

export type TaxiBroadcastPrefAccount = {
  accountId: string;
  phone: string;
  category?: import("@/lib/pay/spendCategory").SpendCategory | null;
};

type Stored = {
  wantOn: boolean;
  accountId: string;
  phone: string;
  category?: string | null;
};

let cached: Stored | null | undefined;

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Stored;
    if (!o || typeof o !== "object") return null;
    if (!o.wantOn) return { ...o, wantOn: false };
    const accountId = String(o.accountId ?? "").trim();
    const phone = String(o.phone ?? "").trim();
    if (!accountId || !phone) return null;
    return {
      wantOn: true,
      accountId,
      phone,
      category: o.category ?? null,
    };
  } catch {
    return null;
  }
}

export async function loadTaxiBroadcastPref(): Promise<Stored | null> {
  if (cached !== undefined) return cached;
  try {
    cached = parse(await SecureStore.getItemAsync(KEY));
  } catch {
    cached = null;
  }
  return cached;
}

export function getTaxiBroadcastPrefCached(): Stored | null {
  return cached === undefined ? null : cached;
}

export async function isTaxiBroadcastWantedPersisted(): Promise<boolean> {
  const p = await loadTaxiBroadcastPref();
  return p?.wantOn === true;
}

export function toBroadcastAccount(stored: Stored): TaxiBroadcastPrefAccount {
  return {
    accountId: stored.accountId,
    phone: stored.phone,
    category: (stored.category ??
      null) as TaxiBroadcastPrefAccount["category"],
  };
}

export async function persistTaxiBroadcastWant(
  enabled: boolean,
  account: TaxiBroadcastPrefAccount,
): Promise<void> {
  if (!enabled) {
    cached = null;
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* best effort */
    }
    return;
  }
  const accountId = String(account.accountId ?? "").trim();
  const phone = String(account.phone ?? "").trim();
  if (!accountId || !phone) return;
  const next: Stored = {
    wantOn: true,
    accountId,
    phone,
    category: account.category ?? null,
  };
  cached = next;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {
    /* best effort */
  }
}

export async function clearTaxiBroadcastPref(): Promise<void> {
  cached = null;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* best effort */
  }
}
