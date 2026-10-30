import { isBleAdvertiserNativeAvailable } from "@/lib/ble/nativeAvailable";
import { prepareBleRadio } from "@/lib/ble/prepareRadio";

let advertiserImport: Promise<
  typeof import("react-native-ble-advertiser") | null
> | null = null;

/** Parse différé — Pay / commerce (pas au splash). */
export function warmBleAdvertiserModule(): void {
  if (!isBleAdvertiserNativeAvailable()) return;
  if (advertiserImport) return;
  advertiserImport = import("react-native-ble-advertiser").catch(() => null);
}

export async function getWarmBleAdvertiser(): Promise<
  typeof import("react-native-ble-advertiser") | null
> {
  warmBleAdvertiserModule();
  return advertiserImport ?? null;
}

/** Radio déjà OK → 1er « En ligne » sans re-parcourir tout le JS froid. */
export function warmBleBroadcastRadio(): void {
  warmBleAdvertiserModule();
  void prepareBleRadio({ advertise: true, forcePrompt: false }).catch(() => {});
}
