import {
  startTaxiBroadcast,
  stopTaxiBroadcast,
} from "@/lib/ble/advertise";
import {
  startBleBroadcastForeground,
  stopBleBroadcastForeground,
} from "@/lib/ble/foregroundService";
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
/** Utilisateur veut rester en ligne (y compris arrière-plan). */
let wantOn = false;
let lastAccount: TaxiBroadcastAccount | null = null;
const listeners = new Set<Listener>();

function emit() {
  const snap = { on, busy, status };
  listeners.forEach((l) => l(snap));
}

export function getTaxiBroadcastSnapshot(): TaxiBroadcastSnapshot {
  return { on, busy, status };
}

export function subscribeTaxiBroadcast(listener: Listener): () => void {
  listeners.add(listener);
  listener(getTaxiBroadcastSnapshot());
  return () => listeners.delete(listener);
}

async function showForegroundNotification(): Promise<void> {
  await startBleBroadcastForeground({
    title: i18n.t("commerce.onlineNotificationTitle"),
    body: i18n.t("commerce.onlineNotificationBody"),
    stopLabel: i18n.t("commerce.onlineNotificationStop"),
  });
}

export async function setTaxiBroadcastEnabled(
  enabled: boolean,
  account: TaxiBroadcastAccount,
): Promise<{ status: BleAdvertiseStatus; message?: string }> {
  lastAccount = account;

  if (!enabled) {
    wantOn = false;
    on = false;
    status = "idle";
    busy = false;
    emit();
    await withTimeout(stopBleBroadcastForeground(), 800, undefined);
    await withTimeout(stopTaxiBroadcast(), 1_200, undefined);
    return { status: "idle" };
  }

  if (!account.accountId || !account.phone) {
    on = false;
    status = "error";
    emit();
    return { status: "error", message: "INVALID_ACCOUNT" };
  }

  wantOn = true;
  busy = true;
  emit();

  try {
    const res = await withTimeout(
      startTaxiBroadcast({
        accountId: account.accountId,
        phone: account.phone,
        category: account.category ?? null,
      }),
      12_000,
      { ok: false, status: "error" as const, message: "TIMEOUT" },
    );

    if (!wantOn) {
      await stopBleBroadcastForeground();
      void stopTaxiBroadcast();
      on = false;
      status = "idle";
      emit();
      return { status: "idle" };
    }

    if (res.ok) {
      await withTimeout(showForegroundNotification(), 1_500, undefined);
      on = true;
      status = "broadcasting";
      emit();
      return { status: "broadcasting" };
    }

    await stopBleBroadcastForeground();
    if (res.message === "TIMEOUT") {
      await withTimeout(stopTaxiBroadcast(), 800, undefined);
    }
    on = false;
    const nextStatus = res.status === "idle" ? "error" : res.status;
    status = nextStatus;
    emit();
    return { status: nextStatus, message: res.message };
  } finally {
    busy = false;
    emit();
  }
}

/** Change d’identité en restant en ligne : stop radio puis relance auto. */
export async function retargetTaxiBroadcast(
  account: TaxiBroadcastAccount,
): Promise<{ status: BleAdvertiseStatus; message?: string }> {
  if (!wantOn && !on) {
    return { status: "idle" };
  }
  lastAccount = account;
  wantOn = true;
  on = false;
  busy = true;
  emit();

  try {
    await withTimeout(stopBleBroadcastForeground(), 800, undefined);
    await withTimeout(stopTaxiBroadcast(), 1_200, undefined);
    if (!wantOn) {
      on = false;
      status = "idle";
      emit();
      return { status: "idle" };
    }
    if (!account.accountId || !account.phone) {
      wantOn = false;
      on = false;
      status = "error";
      emit();
      return { status: "error", message: "INVALID_ACCOUNT" };
    }

    const res = await withTimeout(
      startTaxiBroadcast({
        accountId: account.accountId,
        phone: account.phone,
        category: account.category ?? null,
      }),
      12_000,
      { ok: false, status: "error" as const, message: "TIMEOUT" },
    );

    if (!wantOn) {
      await withTimeout(stopBleBroadcastForeground(), 800, undefined);
      void stopTaxiBroadcast();
      on = false;
      status = "idle";
      emit();
      return { status: "idle" };
    }

    if (res.ok) {
      await withTimeout(showForegroundNotification(), 1_500, undefined);
      on = true;
      status = "broadcasting";
      emit();
      return { status: "broadcasting" };
    }

    await withTimeout(stopBleBroadcastForeground(), 800, undefined);
    if (res.message === "TIMEOUT") {
      await withTimeout(stopTaxiBroadcast(), 800, undefined);
    }
    on = false;
    const nextStatus = res.status === "idle" ? "error" : res.status;
    status = nextStatus;
    emit();
    return { status: nextStatus, message: res.message };
  } finally {
    busy = false;
    emit();
  }
}
export function stopTaxiBroadcastFromSystem(): void {
  if (!wantOn && !on) return;
  const account = lastAccount ?? { accountId: null, phone: null };
  void setTaxiBroadcastEnabled(false, account);
}

export function isTaxiBroadcastWanted(): boolean {
  return wantOn;
}

/** Reload : reset UI sans stop agressif si pas en ligne. */
export function resetTaxiBroadcastUiOnMount(): void {
  if (wantOn) return;
  on = false;
  status = "idle";
  busy = false;
  emit();
}
