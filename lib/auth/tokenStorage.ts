import { Platform } from "react-native";

const WEB_KEY = "blyp_jwt";

/**
 * Jeton en RAM sur iOS/Android : évite tout module natif (SecureStore / AsyncStorage)
 * tant que le dev client n’a pas été reconstruit après ajout de ces libs.
 * Sur web : persistance via localStorage.
 *
 * Persistance native : `npx expo install @react-native-async-storage/async-storage`
 * puis `npx expo run:android` ou `npx expo run:ios`, et tu peux réintroduire AsyncStorage ici.
 */
let nativeMemoryToken: string | null = null;

export async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(WEB_KEY);
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  return nativeMemoryToken;
}

export async function setStoredToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(WEB_KEY, token);
      }
    } catch {
      /* ignore */
    }
    return;
  }
  nativeMemoryToken = token;
}

export async function clearStoredToken(): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(WEB_KEY);
      }
    } catch {
      /* ignore */
    }
    return;
  }
  nativeMemoryToken = null;
}
