import type { NetInfoState } from "@react-native-community/netinfo";

export type NetworkBannerKind = "offline" | "no_internet";

export function getNetInfoBannerKind(
  state: NetInfoState,
): NetworkBannerKind | null {
  if (state.isConnected === false) return "offline";
  if (state.isInternetReachable === false) return "no_internet";
  return null;
}

/** Hors ligne : pas de liaison ou Internet confirmé inaccessible. */
export function isNetworkOffline(state: NetInfoState): boolean {
  return getNetInfoBannerKind(state) != null;
}

/** Délai court — bande fine, pas de clignotement agressif. */
export const OFFLINE_BANNER_DELAY_MS = 400;
