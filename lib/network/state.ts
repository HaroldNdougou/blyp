import type { NetInfoState } from "@react-native-community/netinfo";

export type NetworkBannerKind = "offline" | "no_internet";

export function getNetInfoBannerKind(
  state: NetInfoState,
): NetworkBannerKind | null {
  if (state.isConnected === false) return "offline";
  // Ne pas se fier à isInternetReachable pour la bandeau : sur Android (souvent MIUI)
  // il reste à false alors que le réseau fonctionne (sonde Google / OS capricieux).
  return null;
}

/** Hors ligne : pas de liaison réseau (Wi‑Fi / données coupées). */
export function isNetworkOffline(state: NetInfoState): boolean {
  return state.isConnected === false;
}

/** Délai court — bande fine, pas de clignotement agressif. */
export const OFFLINE_BANNER_DELAY_MS = 400;
