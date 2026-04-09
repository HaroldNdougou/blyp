import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  setAuthSession,
} from "@/lib/auth/authSession";
import { API_BASE_URL, USE_MOCK_API } from "../config";
import { ApiError } from "./errors";
import type { ApiUser, TransactionItem } from "./types";

export {
  ApiError,
  API_ERROR_TRANSACTION_PIN_INVALID,
  isTransactionPinInvalidError,
} from "./errors";

/** Chargé à la demande : en prod (`USE_MOCK_API` false) le parse/execute au cold start évite tout le mock. */
function loadMock() {
  return import("./mockBackend");
}

/** Affiché quand `fetch` échoue (pas une erreur JSON du serveur). */
const API_UNREACHABLE_HINT =
  "La requête réseau a échoué avant la réponse du serveur. Causes fréquentes : Wi‑Fi / 4G instable, timeout, ou API locale sans « adb reverse ». Sur PC : EXPO_PUBLIC_API_URL=http://IP_DU_PC:3001 ou http://127.0.0.1:3001 + adb reverse tcp:3001 tcp:3001 + npx expo run:android.";

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function shouldTryRefreshOn401(path: string): boolean {
  if (path === "/auth/request-otp" || path === "/auth/verify-otp") return false;
  if (path === "/auth/refresh") return false;
  return true;
}

/**
 * Rafraîchit access (+ refresh si rotation) ; met à jour le stockage sécurisé.
 * Appelé depuis `request` sur 401, sans repasser par `request` (évite boucle).
 */
async function refreshSessionTokens(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    let data: { token: string; refreshToken?: string };
    if (USE_MOCK_API) {
      data = (await loadMock()).mockRefreshSession(refresh);
    } else {
      const url = `${API_BASE_URL}/auth/refresh`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      const body = await parseJson(res);
      if (!res.ok) {
        throw new ApiError(
          errorMessageFromResponse(res, body),
          res.status,
          body,
        );
      }
      data = body as { token: string; refreshToken?: string };
    }
    await setAuthSession(data.token, data.refreshToken ?? refresh);
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      await clearAuthSession();
    }
    return false;
  }
}

function errorMessageFromResponse(res: Response, data: unknown): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    const o = data as { error: string; detail?: string };
    let msg = String(o.error);
    if (typeof o.detail === "string" && o.detail.trim()) {
      msg = `${msg}\n\n${o.detail.trim()}`;
    }
    return msg;
  }
  const st = res.statusText?.trim();
  if (st) return st;
  if (res.status) return `Réponse HTTP ${res.status}`;
  return "Erreur réseau";
}

async function request<T>(
  path: string,
  options: RequestInit & {
    token?: string | null;
    /** Évite une boucle après un refresh déjà tenté sur cette chaîne d’appels. */
    skipAuthRefresh?: boolean;
  } = {},
): Promise<T> {
  const { token: tokenOpt, skipAuthRefresh, headers: hdr, ...rest } = options;
  const headers = new Headers(hdr);
  headers.set("Content-Type", "application/json");
  const token = Object.prototype.hasOwnProperty.call(options, "token")
    ? (tokenOpt ?? null)
    : getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = `${API_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
    });
  } catch (cause) {
    const technical =
      cause instanceof Error && cause.message
        ? `\n\nTechnique : ${cause.message}`
        : "";
    throw new ApiError(
      `${API_UNREACHABLE_HINT}\n\nSi le SMS vient d’arriver, réessaie « Valider » dans 2–3 s (souvent un raté passager). Sinon vérifie les logs de l’API (Railway) au moment du clic.${technical}\n\nURL : ${API_BASE_URL || "(vide — mode démo)"}`,
      0,
    );
  }
  const data = await parseJson(res);
  if (!res.ok) {
    if (
      res.status === 401 &&
      !skipAuthRefresh &&
      shouldTryRefreshOn401(path) &&
      getRefreshToken()
    ) {
      const refreshed = await refreshSessionTokens();
      if (refreshed) {
        const { token: _discard, ...retryOpts } = options;
        return request(path, {
          ...retryOpts,
          skipAuthRefresh: true,
        });
      }
    }
    throw new ApiError(errorMessageFromResponse(res, data), res.status, data);
  }
  return data as T;
}

export async function healthCheck(): Promise<boolean> {
  if (USE_MOCK_API) return (await loadMock()).mockHealth();
  try {
    const r = await fetch(`${API_BASE_URL}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

export type AndroidOtpHashHealth = {
  envPresent: boolean;
  rawLength: number;
  rawAsSeenByServer: string;
  validSegmentCount: number;
  valid11CharHashes: string[];
};

export type HealthResponse = {
  ok: boolean;
  database: string;
  sms: {
    sending: boolean;
    provider: string | null;
    devOtpInLogs: boolean;
    misconfigured: boolean;
    androidOtpHash: AndroidOtpHashHealth;
  };
};

/** GET `/health` (détail JSON), ex. pour vérifier `ANDROID_SMS_OTP_APP_HASH` côté Railway. */
export async function fetchHealth(): Promise<HealthResponse> {
  if (USE_MOCK_API) {
    return {
      ok: true,
      database: "mock",
      sms: {
        sending: false,
        provider: null,
        devOtpInLogs: true,
        misconfigured: false,
        androidOtpHash: {
          envPresent: false,
          rawLength: 0,
          rawAsSeenByServer: "",
          validSegmentCount: 0,
          valid11CharHashes: [],
        },
      },
    };
  }
  const url = `${API_BASE_URL}/health`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    const technical =
      cause instanceof Error && cause.message
        ? `\n\nTechnique : ${cause.message}`
        : "";
    throw new ApiError(
      `${API_UNREACHABLE_HINT}${technical}\n\nURL : ${API_BASE_URL}`,
      0,
    );
  }
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(errorMessageFromResponse(res, data), res.status, data);
  }
  return data as HealthResponse;
}

export async function sayHello(): Promise<{
  ok: boolean;
  id: string;
  createdAt: string;
}> {
  if (USE_MOCK_API) return (await loadMock()).mockSayHello();
  return request("/hello", { method: "POST", body: "{}", token: null });
}

export async function requestOtp(phoneDigits: string): Promise<{ ok: boolean }> {
  if (USE_MOCK_API) return (await loadMock()).mockRequestOtp(phoneDigits);
  return request("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ phone: phoneDigits }),
    token: null,
  });
}

export async function verifyOtp(
  phoneDigits: string,
  code: string,
): Promise<{
  token: string;
  refreshToken?: string;
  user: ApiUser;
  isNewAccount?: boolean;
}> {
  if (USE_MOCK_API) return (await loadMock()).mockVerifyOtp(phoneDigits, code);
  const body = JSON.stringify({ phone: phoneDigits, code });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await request("/auth/verify-otp", {
        method: "POST",
        body,
        token: null,
      });
    } catch (e) {
      lastError = e;
      if (e instanceof ApiError && e.status === 0 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export async function getMe(token: string): Promise<ApiUser> {
  if (USE_MOCK_API) return (await loadMock()).mockGetMe(token);
  return request("/me", { token });
}

export async function setOnboardingTransactionPin(
  token: string,
  pin: string,
): Promise<{ user: ApiUser }> {
  if (USE_MOCK_API)
    return (await loadMock()).mockSetOnboardingTransactionPin(token, pin);
  return request("/auth/onboarding/transaction-pin", {
    method: "POST",
    token,
    body: JSON.stringify({ pin }),
  });
}

export async function setOnboardingProfile(
  token: string,
  firstName: string,
  lastName: string,
): Promise<{ user: ApiUser }> {
  if (USE_MOCK_API)
    return (await loadMock()).mockSetOnboardingProfile(
      token,
      firstName,
      lastName,
    );
  return request("/auth/onboarding/profile", {
    method: "POST",
    token,
    body: JSON.stringify({ firstName, lastName }),
  });
}

export async function deposit(
  token: string,
  amount: number,
): Promise<{ balanceFcfa: number }> {
  if (USE_MOCK_API) return (await loadMock()).mockDeposit(token, amount);
  return request("/wallet/deposit", {
    method: "POST",
    token,
    body: JSON.stringify({ amount }),
  });
}

export async function pay(
  token: string,
  amount: number,
  recipientName: string,
  recipientPhone: string | null,
  transactionPin: string,
): Promise<{ balanceFcfa: number }> {
  if (USE_MOCK_API) {
    const m = await loadMock();
    return m.mockPay(
      token,
      amount,
      recipientName,
      recipientPhone,
      transactionPin,
    );
  }
  return request("/payments/pay", {
    method: "POST",
    token,
    body: JSON.stringify({
      amount,
      recipientName,
      recipientPhone,
      transactionPin,
    }),
  });
}

export async function listTransactions(
  token: string,
): Promise<{ items: TransactionItem[] }> {
  if (USE_MOCK_API) return (await loadMock()).mockListTransactions(token);
  return request("/transactions", { token });
}
