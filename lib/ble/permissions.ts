import type { BlePermissionStatus } from "@/lib/ble/types";
import { withTimeout } from "@/lib/ble/timeout";
import { PermissionsAndroid, Platform } from "react-native";

function androidApiLevel(): number {
  if (typeof Platform.Version === "number") return Platform.Version;
  return parseInt(String(Platform.Version), 10) || 0;
}

function androidPerms(wantAdvertise: boolean): string[] {
  const api = androidApiLevel();
  const perms: string[] = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ];
  if (api >= 31) {
    perms.push(
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
    );
    if (wantAdvertise) perms.push("android.permission.BLUETOOTH_ADVERTISE");
  }
  return perms;
}

/** Lecture seule — aucun dialogue système. */
export async function checkBlePermissions(opts?: {
  advertise?: boolean;
}): Promise<BlePermissionStatus> {
  if (Platform.OS === "web") return "unavailable";
  if (Platform.OS !== "android") return "granted";
  try {
    for (const p of androidPerms(Boolean(opts?.advertise))) {
      const ok = await PermissionsAndroid.check(
        p as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS],
      );
      if (!ok) return "denied";
    }
    return "granted";
  } catch {
    return "unavailable";
  }
}

/**
 * Permissions BLE scan (+ advertise si demandé).
 * Un seul passage : pas de 2ᵉ popup Expo Location si Android a déjà refusé.
 */
export async function requestBlePermissions(opts?: {
  advertise?: boolean;
}): Promise<BlePermissionStatus> {
  if (Platform.OS === "web") return "unavailable";
  if (Platform.OS === "ios") return "granted";

  const api = androidApiLevel();
  const wantAdvertise = Boolean(opts?.advertise);

  try {
    const perms = androidPerms(wantAdvertise);

    const result = await withTimeout(
      PermissionsAndroid.requestMultiple(
        perms as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][],
      ),
      12_000,
      null,
    );
    if (!result) return "denied";

    const fine =
      result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const coarse =
      result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;
    if (!fine && !coarse) {
      return "denied";
    }

    if (api >= 31) {
      const scan =
        result["android.permission.BLUETOOTH_SCAN" as keyof typeof result] ===
        PermissionsAndroid.RESULTS.GRANTED;
      const connect =
        result["android.permission.BLUETOOTH_CONNECT" as keyof typeof result] ===
        PermissionsAndroid.RESULTS.GRANTED;
      if (!scan || !connect) return "denied";
      if (wantAdvertise) {
        const advertise =
          result[
            "android.permission.BLUETOOTH_ADVERTISE" as keyof typeof result
          ] === PermissionsAndroid.RESULTS.GRANTED;
        if (!advertise) return "denied";
      }
    }
  } catch {
    return "denied";
  }

  return "granted";
}
