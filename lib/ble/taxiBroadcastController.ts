import {
  startTaxiBroadcast,
  stopTaxiBroadcast,
} from "@/lib/ble/advertise";
import {
  dismissBroadcastRecoveryNotification,
  notifyBroadcastInterrupted,
} from "@/lib/ble/broadcastRecoveryNotify";
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
  wantOn: boolean;
  busy: boolean;
  status: BleAdvertiseStatus;
  interrupted: boolean;
};

type Listener = (snap: TaxiBroadcastSnapshot) => void;

let on = false;
let wantOn = false;
let busy = false;
let status: BleAdvertiseStatus = "idle";
let lastAccount: TaxiBroadcastAccount | null = null;
let activateGeneration = 0;
let interruptGeneration = 0;
let recoveryNotified = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
const listeners = new Set<Listener>();

function snapshot(): TaxiBroadcastSnapshot {
  return {
    on,
    wantOn,
    busy,
    status,
    interrupted: wantOn && !on,
  };
}

function emit() {
  listeners.forEach((l) => l(snapshot()));
}

export function getTaxiBroadcastSnapshot(): TaxiBroadcastSnapshot {
  return snapshot();
}

export function subscribeTaxiBroadcast(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleBroadcastRetry() {
  if (!wantOn || on) return;
  if (retryTimer) return;
  const delay = Math.min(30_000, Math.round(1_800 * Math.pow(1.45, retryAttempt)));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryAttempt += 1;
    void attemptTaxiBroadcastRecovery({ forcePrompt: false });
  }, delay);
}

function showForegroundOnlineNotification(): void {
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

function showForegroundInterruptedNotification(): void {
  void withTimeout(
    startBleBroadcastForeground({
      title: i18n.t("profile.broadcastInterruptedTitle"),
      body: i18n.t("profile.broadcastInterruptedBody"),
      stopLabel: i18n.t("commerce.onlineNotificationStop"),
    }),
    2_000,
    undefined,
  );
}

async function runBroadcastStart(
  account: TaxiBroadcastAccount,
  forcePrompt: boolean,
): Promise<{ ok: boolean; status: BleAdvertiseStatus; message?: string }> {
  if (!account.accountId || !account.phone) {
    return { ok: false, status: "error", message: "INVALID_ACCOUNT" };
  }

  const res = await withTimeout(
    startTaxiBroadcast({
      accountId: account.accountId,
      phone: account.phone,
      category: account.category ?? null,
      forcePrompt,
    }),
    20_000,
    { ok: false, status: "error" as const, message: "TIMEOUT" },
  );

  if (res.ok) {
    return { ok: true, status: "broadcasting" };
  }
  return {
    ok: false,
    status: res.status === "idle" ? "error" : res.status,
    message: res.message,
  };
}

function markBroadcastOk() {
  retryAttempt = 0;
  clearRetryTimer();
  recoveryNotified = false;
  on = true;
  status = "broadcasting";
  busy = false;
  emit();
  void dismissBroadcastRecoveryNotification();
  showForegroundOnlineNotification();
}

function markBroadcastInterrupted(
  account: TaxiBroadcastAccount,
  nextStatus: BleAdvertiseStatus,
  message?: string,
  opts?: { notifyUser?: boolean },
) {
  on = false;
  wantOn = true;
  status = nextStatus;
  busy = false;
  emit();
  void persistTaxiBroadcastWant(true, account);
  showForegroundInterruptedNotification();
  const shouldNotify = opts?.notifyUser ?? true;
  if (shouldNotify && !recoveryNotified) {
    recoveryNotified = true;
    interruptGeneration += 1;
    void notifyBroadcastInterrupted(interruptGeneration);
  }
  scheduleBroadcastRetry();
  return { status: nextStatus, message };
}

export async function attemptTaxiBroadcastRecovery(opts?: {
  forcePrompt?: boolean;
}): Promise<{ status: BleAdvertiseStatus; message?: string }> {
  if (!wantOn) {
    const saved = await loadTaxiBroadcastPref();
    if (!saved?.wantOn) {
      return { status: "idle" };
    }
    wantOn = true;
    lastAccount = toBroadcastAccount(saved);
  }

  const account = lastAccount;
  if (!account?.accountId || !account.phone) {
    return { status: "error", message: "INVALID_ACCOUNT" };
  }

  if (busy) {
    return { status: status === "broadcasting" ? "broadcasting" : status };
  }

  const gen = ++activateGeneration;
  busy = true;
  on = false;
  emit();

  const res = await runBroadcastStart(account, Boolean(opts?.forcePrompt));

  if (gen !== activateGeneration || !wantOn) {
    busy = false;
    emit();
    return { status: "idle" };
  }

  if (res.ok) {
    markBroadcastOk();
    return { status: "broadcasting" };
  }

  if (res.message === "TIMEOUT") {
    await withTimeout(stopTaxiBroadcast(), 500, undefined);
  }

  return markBroadcastInterrupted(account, res.status, res.message, {
    notifyUser: Boolean(opts?.forcePrompt),
  });
}

export async function setTaxiBroadcastEnabled(
  enabled: boolean,
  account: TaxiBroadcastAccount,
): Promise<{ status: BleAdvertiseStatus; message?: string }> {
  lastAccount = account;
  const gen = ++activateGeneration;
  clearRetryTimer();

  if (!enabled) {
    wantOn = false;
    on = false;
    status = "idle";
    busy = false;
    retryAttempt = 0;
    emit();
    void persistTaxiBroadcastWant(false, account);
    void dismissBroadcastRecoveryNotification();
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

  if (wantOn && !on) {
    return attemptTaxiBroadcastRecovery({ forcePrompt: true });
  }

  wantOn = true;
  void persistTaxiBroadcastWant(true, account);
  on = false;
  status = "idle";
  busy = true;
  emit();

  const res = await runBroadcastStart(account, true);

  if (gen !== activateGeneration || !wantOn) {
    busy = false;
    await withTimeout(stopBleBroadcastForeground(), 500, undefined);
    void stopTaxiBroadcast();
    on = false;
    status = "idle";
    emit();
    return { status: "idle" };
  }

  if (res.ok) {
    markBroadcastOk();
    void persistTaxiBroadcastWant(true, account);
    return { status: "broadcasting" };
  }

  await withTimeout(stopBleBroadcastForeground(), 500, undefined);
  if (res.message === "TIMEOUT") {
    await withTimeout(stopTaxiBroadcast(), 500, undefined);
  }

  return markBroadcastInterrupted(account, res.status, res.message, {
    notifyUser: false,
  });
}

export async function retargetTaxiBroadcast(
  account: TaxiBroadcastAccount,
  opts?: { forcePrompt?: boolean },
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
    void persistTaxiBroadcastWant(false, account);
    return { status: "error", message: "INVALID_ACCOUNT" };
  }

  const gen = ++activateGeneration;
  wantOn = true;
  busy = true;
  on = false;
  emit();
  await withTimeout(stopBleBroadcastForeground(), 500, undefined);
  await withTimeout(stopTaxiBroadcast(), 800, undefined);
  if (gen !== activateGeneration || !wantOn) {
    busy = false;
    on = false;
    status = "idle";
    emit();
    return { status: "idle" };
  }

  const res = await runBroadcastStart(
    account,
    opts?.forcePrompt ?? false,
  );

  if (gen !== activateGeneration || !wantOn) {
    busy = false;
    on = false;
    status = "idle";
    emit();
    return { status: "idle" };
  }

  if (res.ok) {
    markBroadcastOk();
    void persistTaxiBroadcastWant(true, account);
    return { status: "broadcasting" };
  }

  return markBroadcastInterrupted(account, res.status, res.message, {
    notifyUser: true,
  });
}

export function stopTaxiBroadcastFromSystem(): void {
  if (!wantOn && !on) return;
  const account = lastAccount ?? { accountId: null, phone: null };
  void setTaxiBroadcastEnabled(false, account);
}

export function isTaxiBroadcastWanted(): boolean {
  return wantOn;
}

export async function bootstrapTaxiBroadcastState(): Promise<void> {
  if (wantOn || on) return;

  const saved = await loadTaxiBroadcastPref();
  if (saved?.wantOn) {
    const account = toBroadcastAccount(saved);
    lastAccount = account;
    wantOn = true;
    on = false;
    busy = true;
    status = "idle";
    emit();
    await retargetTaxiBroadcast(account, { forcePrompt: false });
    return;
  }

  on = false;
  wantOn = false;
  status = "idle";
  busy = false;
  emit();
}

export function resetTaxiBroadcastUiOnMount(): void {
  void bootstrapTaxiBroadcastState();
}

export async function clearTaxiBroadcastOnSignOut(): Promise<void> {
  clearRetryTimer();
  wantOn = false;
  on = false;
  status = "idle";
  busy = false;
  retryAttempt = 0;
  emit();
  await clearTaxiBroadcastPref();
  void dismissBroadcastRecoveryNotification();
  await withTimeout(stopBleBroadcastForeground(), 500, undefined);
  await withTimeout(stopTaxiBroadcast(), 800, undefined);
}
