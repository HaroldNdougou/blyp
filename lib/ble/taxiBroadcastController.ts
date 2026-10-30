import {
  startTaxiBroadcast,
  stopTaxiBroadcast,
} from "@/lib/ble/advertise";
import {
  startBleBroadcastForeground,
  stopBleBroadcastForeground,
} from "@/lib/ble/foregroundService";
import {
  clearTaxiBroadcastPref,
  loadTaxiBroadcastPref,
  persistTaxiBroadcastWant,
  toBroadcastAccount,
} from "@/lib/ble/taxiBroadcastPref";
import type { BleAdvertiseStatus } from "@/lib/ble/types";
import { withTimeout } from "@/lib/ble/timeout";
import i18n from "@/lib/i18n";

export type TaxiBroadcastAccount = {
  accountId: string | null | undefined;
  phone: string | null | undefined;
  category?: import("@/lib/pay/spendCategory").SpendCategory | null;
};

export type TaxiBroadcastSnapshot = {
  on: boolean;
  busy: boolean;
  status: BleAdvertiseStatus;
};

type Listener = (snap: TaxiBroadcastSnapshot) => void;

let on = false;
let busy = false;
let status: BleAdvertiseStatus = "idle";
let wantOn = false;
let lastAccount: TaxiBroadcastAccount | null = null;
let activateGeneration = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(getTaxiBroadcastSnapshot()));
}

export function getTaxiBroadcastSnapshot(): TaxiBroadcastSnapshot {
  return { on, busy, status };
}

export function subscribeTaxiBroadcast(listener: Listener): () => void {
  listeners.add(listener);
  listener(getTaxiBroadcastSnapshot());
  return () => listeners.delete(listener);
}

function showForegroundNotificationFireAndForget(): void {
  void withTimeout(
    startBleBroadcastForeground({
      title: i18n.t("commerce.onlineNotificationTitle"),
      body: i18n.t("commerce.onlineNotificationBody"),
      stopLabel: i18n.t("commerce.onlineNotificationStop"),
    }),
    2_000,
    undefined,
  );
}

export async function setTaxiBroadcastEnabled(
  enabled: boolean,
  account: TaxiBroadcastAccount,
): Promise<{ status: BleAdvertiseStatus; message?: string }> {
  lastAccount = account;
  const gen = ++activateGeneration;

  if (!enabled) {
    wantOn = false;
    on = false;
    status = "idle";
    busy = false;
    emit();
    void persistTaxiBroadcastWant(false, account);
    await withTimeout(stopBleBroadcastForeground(), 500, undefined);
    await withTimeout(stopTaxiBroadcast(), 800, undefined);
    return { status: "idle" };
  }

  if (!account.accountId || !account.phone) {
    wantOn = false;
    on = false;
    status = "error";
    busy = false;
    emit();
    return { status: "error", message: "INVALID_ACCOUNT" };
  }

  wantOn = true;
  /** Pas optimiste : En ligne seulement quand la radio confirme. */
  on = false;
  status = "idle";
  busy = false;
  emit();

  const res = await withTimeout(
    startTaxiBroadcast({
      accountId: account.accountId,
      phone: account.phone,
      category: account.category ?? null,
    }),
    20_000,
    { ok: false, status: "error" as const, message: "TIMEOUT" },
  );

  if (gen !== activateGeneration || !wantOn) {
    await withTimeout(stopBleBroadcastForeground(), 500, undefined);
    void stopTaxiBroadcast();
    on = false;
    status = "idle";
    emit();
    return { status: "idle" };
  }

  if (res.ok) {
    showForegroundNotificationFireAndForget();
    on = true;
    status = "broadcasting";
    emit();
    void persistTaxiBroadcastWant(true, account);
    return { status: "broadcasting" };
  }

  await withTimeout(stopBleBroadcastForeground(), 500, undefined);
  if (res.message === "TIMEOUT") {
    await withTimeout(stopTaxiBroadcast(), 500, undefined);
  }
  wantOn = false;
  on = false;
  const nextStatus = res.status === "idle" ? "error" : res.status;
  status = nextStatus;
  emit();
  void persistTaxiBroadcastWant(false, account);
  return { status: nextStatus, message: res.message };
}

export async function retargetTaxiBroadcast(
  account: TaxiBroadcastAccount,
): Promise<{ status: BleAdvertiseStatus; message?: string }> {
  if (!wantOn && !on) {
    return { status: "idle" };
  }
  lastAccount = account;
  if (!account.accountId || !account.phone) {
    wantOn = false;
    on = false;
    status = "error";
    emit();
    return { status: "error", message: "INVALID_ACCOUNT" };
  }

  const gen = ++activateGeneration;
  wantOn = true;
  await withTimeout(stopBleBroadcastForeground(), 500, undefined);
  await withTimeout(stopTaxiBroadcast(), 800, undefined);
  if (gen !== activateGeneration || !wantOn) {
    on = false;
    status = "idle";
    emit();
    return { status: "idle" };
  }

  const res = await withTimeout(
    startTaxiBroadcast({
      accountId: account.accountId,
      phone: account.phone,
      category: account.category ?? null,
    }),
    20_000,
    { ok: false, status: "error" as const, message: "TIMEOUT" },
  );

  if (gen !== activateGeneration || !wantOn) {
    on = false;
    status = "idle";
    emit();
    return { status: "idle" };
  }

  if (res.ok) {
    showForegroundNotificationFireAndForget();
    on = true;
    status = "broadcasting";
    emit();
    void persistTaxiBroadcastWant(true, account);
    return { status: "broadcasting" };
  }

  wantOn = false;
  on = false;
  const nextStatus = res.status === "idle" ? "error" : res.status;
  status = nextStatus;
  emit();
  void persistTaxiBroadcastWant(false, account);
  return { status: nextStatus, message: res.message };
}

export function stopTaxiBroadcastFromSystem(): void {
  if (!wantOn && !on) return;
  const account = lastAccount ?? { accountId: null, phone: null };
  void setTaxiBroadcastEnabled(false, account);
}

export function isTaxiBroadcastWanted(): boolean {
  return wantOn;
}

/**
 * Au boot : restaure « En ligne » si l’utilisateur ne l’a pas coupé manuellement.
 * Ne coupe pas la diffusion quand l’app passe en arrière-plan.
 */
export async function bootstrapTaxiBroadcastState(): Promise<void> {
  if (wantOn || on) return;

  const saved = await loadTaxiBroadcastPref();
  if (saved?.wantOn) {
    const account = toBroadcastAccount(saved);
    lastAccount = account;
    wantOn = true;
    on = true;
    status = "broadcasting";
    emit();
    void retargetTaxiBroadcast(account);
    return;
  }

  on = false;
  status = "idle";
  busy = false;
  emit();
}

/** @deprecated alias bootstrap */
export function resetTaxiBroadcastUiOnMount(): void {
  void bootstrapTaxiBroadcastState();
}

export async function clearTaxiBroadcastOnSignOut(): Promise<void> {
  wantOn = false;
  on = false;
  status = "idle";
  busy = false;
  emit();
  await clearTaxiBroadcastPref();
  await withTimeout(stopBleBroadcastForeground(), 500, undefined);
  await withTimeout(stopTaxiBroadcast(), 800, undefined);
}
