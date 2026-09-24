import { NativeModules, Platform } from "react-native";

/**
 * True seulement si le module natif `BlePlx` est lié.
 */
export function isBlePlxNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  const mod = NativeModules.BlePlx;
  return mod != null && typeof mod.createClient === "function";
}

export function isBleAdvertiserNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  const mod = NativeModules.BLEAdvertiser;
  return (
    mod != null &&
    typeof mod.broadcast === "function" &&
    typeof mod.setCompanyId === "function"
  );
}

export function isBleStackAvailable(): boolean {
  return isBlePlxNativeAvailable();
}
