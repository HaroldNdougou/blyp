import { isBlePlxNativeAvailable } from "@/lib/ble/nativeAvailable";
import { requestBlePermissions } from "@/lib/ble/permissions";
import type { BlePermissionStatus } from "@/lib/ble/types";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { Platform } from "react-native";

export type BleRadioPrepareStatus = BlePermissionStatus | "powered_off";

const BT_REQUEST_ACTION = "android.bluetooth.adapter.action.REQUEST_ENABLE";
const BT_WAIT_MS = 12_000;

async function ensureLocationServicesOn(): Promise<boolean> {
  try {
    if (await Location.hasServicesEnabledAsync()) return true;
    if (Platform.OS !== "android") return false;
    await Location.enableNetworkProviderAsync();
    return Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

async function readBtState(): Promise<string | null> {
  if (!isBlePlxNativeAvailable()) return null;
  try {
    const { BleManager } = await import("react-native-ble-plx");
    const mgr = new BleManager();
    return mgr.state();
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
    await IntentLauncher.startActivityAsync(BT_REQUEST_ACTION);
  } catch {
    return false;
  }

  return waitBtPoweredOn(BT_WAIT_MS);
}

/**
 * Permissions + popups système GPS / Bluetooth avant scan ou diffusion.
 */
export async function prepareBleRadio(opts?: {
  advertise?: boolean;
}): Promise<BleRadioPrepareStatus> {
  if (Platform.OS === "web") return "unavailable";

  const perm = await requestBlePermissions(opts);
  if (perm !== "granted") return perm;

  if (!(await ensureLocationServicesOn())) return "denied";

  if (!(await promptEnableBluetooth())) return "powered_off";

  return "granted";
}
