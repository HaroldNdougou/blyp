import * as Contacts from "expo-contacts";
import { Linking, PermissionsAndroid, Platform } from "react-native";

export type ContactsPermissionStatus =
  | "granted"
  | "denied"
  | "blocked"
  | "unavailable";

async function checkIos(): Promise<ContactsPermissionStatus> {
  try {
    const available = await Contacts.isAvailableAsync();
    if (!available) return "unavailable";
    const p = await Contacts.getPermissionsAsync();
    if (p.status === Contacts.PermissionStatus.GRANTED) return "granted";
    if (p.canAskAgain === false) return "blocked";
    return "denied";
  } catch {
    return "unavailable";
  }
}

async function requestIos(): Promise<ContactsPermissionStatus> {
  try {
    const available = await Contacts.isAvailableAsync();
    if (!available) return "unavailable";
    const p = await Contacts.requestPermissionsAsync();
    if (p.status === Contacts.PermissionStatus.GRANTED) return "granted";
    if (p.canAskAgain === false) return "blocked";
    return "denied";
  } catch {
    return "unavailable";
  }
}

let androidContactsBlocked = false;

/** Android : même API que le BLE — une seule popup système, pas de pré-écran Réglages. */
async function checkAndroid(): Promise<ContactsPermissionStatus> {
  try {
    const ok = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    );
    if (ok) {
      androidContactsBlocked = false;
      return "granted";
    }
    if (androidContactsBlocked) return "blocked";
    return "denied";
  } catch {
    return "unavailable";
  }
}

async function requestAndroid(): Promise<ContactsPermissionStatus> {
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    );
    if (__DEV__) {
      console.log("[contacts] READ_CONTACTS request →", result);
    }
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      androidContactsBlocked = false;
      return "granted";
    }
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      androidContactsBlocked = true;
      return "blocked";
    }
    return "denied";
  } catch (e) {
    if (__DEV__) console.warn("[contacts] request failed", e);
    return "unavailable";
  }
}

/** Lecture seule — aucun dialogue (comme `checkBlePermissions`). */
export async function checkContactsPermission(): Promise<ContactsPermissionStatus> {
  if (Platform.OS === "web") return "unavailable";
  if (Platform.OS === "android") return checkAndroid();
  return checkIos();
}

/** Popup système uniquement — jamais `Linking.openSettings` ici. */
export async function requestContactsPermission(): Promise<ContactsPermissionStatus> {
  if (Platform.OS === "web") return "unavailable";
  if (Platform.OS === "android") return requestAndroid();
  return requestIos();
}

export async function openContactsAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    /* ignore */
  }
}

export async function ensureContactsAccess(opts?: {
  request?: boolean;
}): Promise<ContactsPermissionStatus> {
  const current = await checkContactsPermission();
  if (current === "granted") return "granted";
  if (!opts?.request) return current;
  return requestContactsPermission();
}

export async function ensureContactsGranted(opts?: {
  request?: boolean;
}): Promise<boolean> {
  const status = await ensureContactsAccess(opts);
  return status === "granted";
}

let loginContactsPromptDone = false;
let loginPromptInFlight: Promise<ContactsPermissionStatus> | null = null;

export function resetContactsPermissionSession(): void {
  loginContactsPromptDone = false;
  loginPromptInFlight = null;
  androidContactsBlocked = false;
}

/** Une fois par session, au login (avant notifs sur Android / MIUI). */
export async function promptContactsAfterLogin(): Promise<ContactsPermissionStatus> {
  if (loginContactsPromptDone && !loginPromptInFlight) {
    return checkContactsPermission();
  }
  if (loginPromptInFlight) {
    return loginPromptInFlight;
  }

  loginPromptInFlight = (async () => {
    loginContactsPromptDone = true;
    const current = await checkContactsPermission();
    if (current === "granted") return "granted";
    if (Platform.OS === "android") {
      await new Promise((r) => setTimeout(r, 350));
    }
    return requestContactsPermission();
  })().finally(() => {
    loginPromptInFlight = null;
  });

  return loginPromptInFlight;
}
