import {
  startTaxiBroadcast,
  stopTaxiBroadcast,
} from "@/lib/ble/advertise";
import {
  startBleBroadcastForeground,
  stopBleBroadcastForeground,
} from "@/lib/ble/foregroundService";
import type { BleAdvertiseStatus } from "@/lib/ble/types";
import i18n from "@/lib/i18n";

export type TaxiBroadcastAccount = {
  accountId: string | null | undefined;
  phone: string | null | undefined;
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
    await stopBleBroadcastForeground();
    void stopTaxiBroadcast();
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
    const res = await startTaxiBroadcast({
      accountId: account.accountId,
      phone: account.phone,
    });

    if (!wantOn) {
      await stopBleBroadcastForeground();
      void stopTaxiBroadcast();
      on = false;
      status = "idle";
      emit();
      return { status: "idle" };
    }

    if (res.ok) {
      await showForegroundNotification();
      on = true;
      status = "broadcasting";
      emit();
      return { status: "broadcasting" };
    }

    await stopBleBroadcastForeground();
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

/** Notif « Arrêter » ou stop externe — coupe tout. */
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
