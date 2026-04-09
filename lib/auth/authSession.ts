import type { ApiUser } from "@/lib/api/types";
import { Platform } from "react-native";

const STORAGE_KEY = "blyp_auth_session_v1";
/** Ancienne clé web (JWT seul) — migrée une fois vers STORAGE_KEY. */
const LEGACY_WEB_JWT_KEY = "blyp_jwt";

type StoredPayload = {
  accessToken: string;
  refreshToken?: string;
  userSnapshot?: ApiUser;
};

let cache: {
  access: string | null;
  refresh: string | null;
  userSnapshot: ApiUser | null;
} = {
  access: null,
  refresh: null,
  userSnapshot: null,
};

function parseUserSnapshot(raw: unknown): ApiUser | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.phone !== "string") return null;
  if (typeof u.balanceFcfa !== "number" || !Number.isFinite(u.balanceFcfa)) {
    return null;
  }
  if (typeof u.needsOnboarding !== "boolean") return null;
  if (
    u.onboardingStep !== null &&
    u.onboardingStep !== "pin" &&
    u.onboardingStep !== "profile"
  ) {
    return null;
  }
  if (u.firstName !== null && typeof u.firstName !== "string") return null;
  if (u.lastName !== null && typeof u.lastName !== "string") return null;
  return u as ApiUser;
}

let hydratePromise: Promise<void> | null = null;

type AuthSessionListener = (s: {
  access: string | null;
  refresh: string | null;
}) => void;

const listeners = new Set<AuthSessionListener>();

type SecureStoreModule = typeof import("expo-secure-store");
/** `undefined` = pas encore tenté ; `null` = indisponible (rebuild natif requis pour la persistance). */
let secureStoreModule: SecureStoreModule | null | undefined;

function getSecureStore(): SecureStoreModule | null {
  if (Platform.OS === "web") return null;
  if (secureStoreModule !== undefined) return secureStoreModule;
  try {
    // require différé : évite le crash au chargement si ExpoSecureStore n’est pas dans le binaire.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    secureStoreModule = require("expo-secure-store") as SecureStoreModule;
    return secureStoreModule;
  } catch {
    secureStoreModule = null;
    return null;
  }
}

/** Fallback RAM si le module natif SecureStore n’est pas lié (session non persistée au cold start). */
let nativeMemorySessionJson: string | null = null;

export function subscribeAuthSession(cb: AuthSessionListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  const snap = { access: cache.access, refresh: cache.refresh };
  listeners.forEach((l) => l(snap));
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage === "undefined") return null;
      const json = localStorage.getItem(STORAGE_KEY);
      if (json) return json;
      const legacy = localStorage.getItem(LEGACY_WEB_JWT_KEY);
      if (legacy) {
        const migrated = JSON.stringify({
          accessToken: legacy,
          refreshToken: undefined,
        } satisfies StoredPayload);
        localStorage.setItem(STORAGE_KEY, migrated);
        localStorage.removeItem(LEGACY_WEB_JWT_KEY);
        return migrated;
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  const SS = getSecureStore();
  if (SS) {
    try {
      return await SS.getItemAsync(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return nativeMemorySessionJson;
}

async function writeRaw(json: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage === "undefined") return;
      if (json) localStorage.setItem(STORAGE_KEY, json);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const SS = getSecureStore();
  if (SS) {
    try {
      if (json) await SS.setItemAsync(STORAGE_KEY, json);
      else await SS.deleteItemAsync(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  nativeMemorySessionJson = json;
}

export function getAccessToken(): string | null {
  return cache.access;
}

export function getRefreshToken(): string | null {
  return cache.refresh;
}

/** Profil lu au hydrate — pour premier rendu sans attendre `getMe`. */
export function getUserSnapshot(): ApiUser | null {
  return cache.userSnapshot;
}

/** À appeler au démarrage avant les appels API authentifiés. */
export async function hydrateAuthSession(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const raw = await readRaw();
    if (!raw) {
      cache = { access: null, refresh: null, userSnapshot: null };
      return;
    }
    try {
      const o = JSON.parse(raw) as Partial<StoredPayload>;
      cache.access =
        typeof o.accessToken === "string" && o.accessToken.length > 0
          ? o.accessToken
          : null;
      cache.refresh =
        typeof o.refreshToken === "string" && o.refreshToken.length > 0
          ? o.refreshToken
          : null;
      cache.userSnapshot = parseUserSnapshot(o.userSnapshot) ?? null;
    } catch {
      cache = { access: null, refresh: null, userSnapshot: null };
    }
  })();
  await hydratePromise;
}

/**
 * Met à jour la session. Si `userSnapshot` est omis, le snapshot déjà en cache est conservé (ex. refresh token).
 * Passer `null` efface le snapshot persisté.
 */
export async function setAuthSession(
  accessToken: string,
  refreshToken: string | null,
  userSnapshot?: ApiUser | null,
): Promise<void> {
  cache.access = accessToken;
  cache.refresh = refreshToken;
  if (userSnapshot !== undefined) {
    cache.userSnapshot = userSnapshot;
  }
  const payload: StoredPayload = { accessToken };
  if (refreshToken) payload.refreshToken = refreshToken;
  if (cache.userSnapshot) payload.userSnapshot = cache.userSnapshot;
  await writeRaw(JSON.stringify(payload));
  emit();
}

export async function clearAuthSession(): Promise<void> {
  cache = { access: null, refresh: null, userSnapshot: null };
  nativeMemorySessionJson = null;
  await writeRaw(null);
  if (Platform.OS === "web") {
    try {
      localStorage?.removeItem(LEGACY_WEB_JWT_KEY);
    } catch {
      /* ignore */
    }
  }
  emit();
}
