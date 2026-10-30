import Constants from "expo-constants";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";

function androidPackage(): string {
  return Constants.expoConfig?.android?.package ?? "com.haroldndougou.blyp";
}

/** Écran permissions Blyp (MIUI puis fiche app Android). */
export async function openBleAppSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  const pkg = androidPackage();
  try {
    await IntentLauncher.startActivityAsync(
      "miui.intent.action.APP_PERM_EDITOR",
      { extra: { extra_pkgname: pkg } },
    );
    return;
  } catch {
    /* pas MIUI */
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${pkg}` },
    );
  } catch {
    await Linking.openSettings();
  }
}

export async function openAndroidLocationSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS,
    );
  } catch {
    await openBleAppSettings();
  }
}

export async function openAndroidBluetoothSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync("android.settings.BLUETOOTH_SETTINGS");
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.BLUETOOTH_SETTINGS,
      );
    } catch {
      await openBleAppSettings();
    }
  }
}
