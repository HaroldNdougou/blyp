import type { BlePermissionStatus } from "@/lib/ble/types";
import * as Location from "expo-location";
import { PermissionsAndroid, Platform } from "react-native";

function androidApiLevel(): number {
  if (typeof Platform.Version === "number") return Platform.Version;
  return parseInt(String(Platform.Version), 10) || 0;
}

/**
 * Permissions BLE scan (+ advertise si demandé).
 */
export async function requestBlePermissions(opts?: {
  advertise?: boolean;
}): Promise<BlePermissionStatus> {
  if (Platform.OS === "web") return "unavailable";
  if (Platform.OS === "ios") return "granted";

  const api = androidApiLevel();
  const wantAdvertise = Boolean(opts?.advertise);

  try {
    const perms: string[] = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];
    if (api >= 31) {
      perms.push(
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
      );
      if (wantAdvertise) {
        perms.push("android.permission.BLUETOOTH_ADVERTISE");
      }
    }

    const result = await PermissionsAndroid.requestMultiple(
      perms as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][],
    );

    const fine =
      result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const coarse =
      result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;
    if (!fine && !coarse) {
      const loc = await Location.requestForegroundPermissionsAsync();
      if (loc.status !== "granted") {
        return loc.canAskAgain === false ? "blocked" : "denied";
      }
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
    try {
      const loc = await Location.requestForegroundPermissionsAsync();
      if (loc.status !== "granted") return "denied";
    } catch {
      return "unavailable";
    }
  }

  return "granted";
}
