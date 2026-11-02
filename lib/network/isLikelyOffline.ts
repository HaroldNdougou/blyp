/** État réseau connu indisponible (bandeau offline ou NetInfo explicite). */
export function isLikelyOfflineNow(state: {
  isOffline: boolean;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}): boolean {
  if (state.isOffline) return true;
  if (state.isConnected === false) return true;
  if (state.isInternetReachable === false) return true;
  return false;
}
