import Constants from "expo-constants";

function readConfiguredApiUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (env) return env;
  const extra = Constants.expoConfig?.extra as
    | { EXPO_PUBLIC_API_URL?: string }
    | undefined;
  return extra?.EXPO_PUBLIC_API_URL?.trim() ?? "";
}

const configured = readConfiguredApiUrl();

/**
 * Sans `EXPO_PUBLIC_API_URL` : mode démo (inscription / solde / paiements simulés, sans serveur).
 * Pour la prod : définis l’URL de ton API hébergée (EAS env, .env, ou `app.json` → extra).
 */
export const USE_MOCK_API = configured.length === 0;

export const API_BASE_URL = USE_MOCK_API ? "" : configured.replace(/\/$/, "");
