import { Platform } from "react-native";

const GAP_MS = 500;

let completedForToken: string | null = null;
let inflight: Promise<void> | null = null;
let inflightToken: string | null = null;

export function resetPostLoginBootstrap(): void {
  completedForToken = null;
  inflight = null;
  inflightToken = null;
}

/**
 * Une seule exécution par token (Strict Mode / double effet React).
 * MIUI : contacts **avant** notifs — sinon READ_CONTACTS revient never_ask_again sans popup.
 */
export async function runPostLoginBootstrap(accessToken: string): Promise<void> {
  if (Platform.OS === "web") return;
  if (completedForToken === accessToken) return;
  if (inflight && inflightToken === accessToken) {
    await inflight;
    return;
  }

  inflightToken = accessToken;
  inflight = (async () => {
    const permissions = await import("@/lib/contacts/permissions");
    await permissions.promptContactsAfterLogin();

    const { loadPhoneContacts } = await import("@/lib/contacts/phoneContacts");
    await loadPhoneContacts(null).catch(() => {});

    await new Promise((r) => setTimeout(r, GAP_MS));

    const push = await import("@/lib/push/register");
    await push.registerPushToken(accessToken);

    completedForToken = accessToken;
  })().finally(() => {
    inflight = null;
    inflightToken = null;
  });

  await inflight;
}
