import {
  allowBleAutoPromptAgain,
  getBlePrepareInFlight,
  isBleAutoPromptDeclined,
  markBleAutoPromptDeclined,
  setBlePrepareInFlight,
} from "@/lib/ble/consent";
import { isPayScanFocused } from "@/lib/ble/payScanGate";
import { isBlePlxNativeAvailable } from "@/lib/ble/nativeAvailable";
import {
  checkBlePermissions,
  requestBlePermissions,
} from "@/lib/ble/permissions";
import type { BlePermissionStatus } from "@/lib/ble/types";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { withTimeout } from "@/lib/ble/timeout";
import { Platform } from "react-native";

export type BleRadioPrepareStatus = BlePermissionStatus | "powered_off";

const BT_REQUEST_ACTION = "android.bluetooth.adapter.action.REQUEST_ENABLE";
/** Grâce courte si l’utilisateur vient d’accepter (l’adaptateur démarre). */
const BT_SPIN_UP_MS = 450;
const GPS_PROMPT_MS = 4_000;

async function locationServicesOn(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

async function readBtState(): Promise<string | null> {
  if (!isBlePlxNativeAvailable()) return null;
  try {
    const { BleManager } = await import("react-native-ble-plx");
    const mgr = new BleManager();
    return withTimeout(mgr.state(), 700, null);
  } catch {
    return null;
  }
}

async function waitBtPoweredOn(timeoutMs: number): Promise<boolean> {
  if (!isBlePlxNativeAvailable()) return false;
  try {
    const { BleManager } = await import("react-native-ble-plx");
    const mgr = new BleManager();
    if ((await mgr.state()) === "PoweredOn") return true;

    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub.remove();
        resolve(ok);
      };
      const sub = mgr.onStateChange((s) => {
        if (s === "PoweredOn") finish(true);
      }, true);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  } catch {
    return false;
  }
}

async function promptEnableBluetooth(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if ((await readBtState()) === "PoweredOn") return true;

  try {
    await withTimeout(
      IntentLauncher.startActivityAsync(BT_REQUEST_ACTION),
      6_000,
      undefined,
    );
  } catch {
    return (await readBtState()) === "PoweredOn";
  }

  const after = await readBtState();
  if (after === "PoweredOn") return true;
  if (after === "PoweredOff" || after === "Unauthorized") return false;
  return waitBtPoweredOn(BT_SPIN_UP_MS);
}

async function ensureLocationServicesOn(): Promise<boolean> {
  try {
    if (await Location.hasServicesEnabledAsync()) return true;
    if (Platform.OS !== "android") return false;
    const prompted = Location.enableNetworkProviderAsync();
    const timed = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), GPS_PROMPT_MS);
    });
    await Promise.race([prompted.then(() => true), timed]);
    return Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

async function prepareSilent(opts?: {
  advertise?: boolean;
}): Promise<BleRadioPrepareStatus> {
  const perm = await checkBlePermissions(opts);
  if (perm !== "granted") return perm;
  if (!(await locationServicesOn())) return "denied";
  const bt = await readBtState();
  if (bt && bt !== "PoweredOn") return "powered_off";
  return "granted";
}

async function prepareInteractive(opts?: {
  advertise?: boolean;
}): Promise<BleRadioPrepareStatus> {
  const perm = await requestBlePermissions(opts);
  if (perm !== "granted") {
    markBleAutoPromptDeclined("denied");
    return perm;
  }
  if (!(await ensureLocationServicesOn())) {
    markBleAutoPromptDeclined("denied");
    return "denied";
  }
  if (!(await promptEnableBluetooth())) {
    markBleAutoPromptDeclined("powered_off");
    return "powered_off";
  }
  allowBleAutoPromptAgain();
  return "granted";
}

/**
 * Permissions + popups GPS / Bluetooth.
 * `forcePrompt` : tap utilisateur (pastille / interrupteur En ligne).
 * Sinon : une seule demande ; un refus → plus de dialogue auto.
 */
export async function prepareBleRadio(opts?: {
  advertise?: boolean;
  forcePrompt?: boolean;
}): Promise<BleRadioPrepareStatus> {
  if (Platform.OS === "web") return "unavailable";

  const force = Boolean(opts?.forcePrompt);
  const inFlight = getBlePrepareInFlight();
  if (inFlight && !force) {
    return inFlight as Promise<BleRadioPrepareStatus>;
  }

  const job = (async (): Promise<BleRadioPrepareStatus> => {
    if (!force && (!isPayScanFocused() || isBleAutoPromptDeclined())) {
      return prepareSilent(opts);
    }
    return prepareInteractive(opts);
  })();

  return setBlePrepareInFlight(job);
}
