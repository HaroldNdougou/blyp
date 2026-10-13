/**
 * Verrouillage appareil (biométrie / code système) avant un paiement — modèle « une confirmation ».
 */
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

export type DeviceAuthResult = "success" | "cancel" | "unavailable";

export async function canUseDeviceAuth(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const has = await LocalAuthentication.hasHardwareAsync();
    if (!has) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function authenticateForPayment(
  promptMessage: string,
): Promise<DeviceAuthResult> {
  if (Platform.OS === "web") return "unavailable";
  if (!(await canUseDeviceAuth())) return "unavailable";
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: false,
    });
    if (res.success) return "success";
    return "cancel";
  } catch {
    return "cancel";
  }
}
