import { isNetworkOffline } from "@/lib/network/state";
import NetInfo from "@react-native-community/netinfo";

/** Lecture instantanée (pas le délai bandeau WhatsApp). */
export async function fetchIsNetworkConnected(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return !isNetworkOffline(state);
  } catch {
    return false;
  }
}
