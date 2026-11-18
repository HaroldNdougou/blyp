import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "blyp_admin_token";

export function apiBase(): string {
  const fromExtra = Constants.expoConfig?.extra?.adminApiBase;
  return String(fromExtra || "https://nma68tjr78.execute-api.af-south-1.amazonaws.com/dev/admin").replace(
    /\/$/,
    "",
  );
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (!token) await SecureStore.deleteItemAsync(TOKEN_KEY);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

type ApiOpts = { method?: string; body?: unknown; token?: string | null; elevation?: string | null };

export async function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  const token = opts.token === undefined ? await getToken() : opts.token;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "blyp-admin",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.elevation) headers["x-admin-elevation"] = opts.elevation;

  const res = await fetch(`${apiBase()}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "Réponse invalide" };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Erreur ${res.status}`) as Error & {
      status?: number;
      code?: string;
      retryAfterSec?: number;
    };
    err.status = res.status;
    err.code = data?.code;
    if (res.status === 403 && data?.code === "ELEVATION_REQUIRED") err.code = "ELEVATION_REQUIRED";
    if (data?.retryAfterSec != null) err.retryAfterSec = Number(data.retryAfterSec);
    throw err;
  }
  return data as T;
}

export async function login(email: string, password: string, totp: string) {
  const data = await api<{ ok: boolean; token: string; expiresInSec: number }>("/api/login", {
    method: "POST",
    body: { email, password, totp },
    token: null,
  });
  await setToken(data.token);
  return data;
}

export async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  const { setSessionPassword } = await import("./adminSession");
  const { clearElevationCache } = await import("./adminWallet");
  setSessionPassword(null);
  clearElevationCache();
  await setToken(null);
}
