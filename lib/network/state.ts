import type { NetInfoState } from "@react-native-community/netinfo";

/** Hors ligne : pas de liaison ou Internet confirmé inaccessible. */
export function isNetworkOffline(state: NetInfoState): boolean {
  if (state.isConnected === false) return true;
  if (state.isInternetReachable === false) return true;
  return false;
}

/** Délai avant d’afficher la bannière (évite le clignotement sur 4G instable). */
export const OFFLINE_BANNER_DELAY_MS = 650;
