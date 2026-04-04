import { API_BASE_URL, USE_MOCK_API } from "../config";
import { ApiError } from "./errors";
import * as mock from "./mockBackend";
import type {
  ApiNotificationItem,
  ApiToastPayload,
  ApiUser,
  TransactionItem,
} from "./types";

export { ApiError } from "./errors";

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
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers: hdr, ...rest } = options;
  const headers = new Headers(hdr);
  headers.set("Content-Type", "application/json");
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
    throw new ApiError(errorMessageFromResponse(res, data), res.status, data);
  }
  return data as T;
}

export async function healthCheck(): Promise<boolean> {
  if (USE_MOCK_API) return mock.mockHealth();
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
  if (USE_MOCK_API) return mock.mockSayHello();
  return request("/hello", { method: "POST", body: "{}" });
}

export async function requestOtp(phoneDigits: string): Promise<{ ok: boolean }> {
  if (USE_MOCK_API) return mock.mockRequestOtp(phoneDigits);
  return request("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ phone: phoneDigits }),
  });
}

export async function verifyOtp(
  phoneDigits: string,
  code: string,
): Promise<{ token: string; user: ApiUser; isNewAccount?: boolean }> {
  if (USE_MOCK_API) return mock.mockVerifyOtp(phoneDigits, code);
  const body = JSON.stringify({ phone: phoneDigits, code });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await request("/auth/verify-otp", {
        method: "POST",
        body,
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
  if (USE_MOCK_API) return mock.mockGetMe(token);
  return request("/me", { token });
}

export async function setOnboardingTransactionPin(
  token: string,
  pin: string,
): Promise<{ user: ApiUser }> {
  if (USE_MOCK_API) return mock.mockSetOnboardingTransactionPin(token, pin);
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
): Promise<{ user: ApiUser; toast?: ApiToastPayload }> {
  if (USE_MOCK_API) return mock.mockSetOnboardingProfile(token, firstName, lastName);
  return request("/auth/onboarding/profile", {
    method: "POST",
    token,
    body: JSON.stringify({ firstName, lastName }),
  });
}

export async function deposit(
  token: string,
  amount: number,
): Promise<{
  balanceFcfa: number;
  transactionId?: string;
  toast?: ApiToastPayload;
}> {
  if (USE_MOCK_API) return mock.mockDeposit(token, amount);
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
): Promise<{ balanceFcfa: number; toast?: ApiToastPayload }> {
  if (USE_MOCK_API)
    return mock.mockPay(
      token,
      amount,
      recipientName,
      recipientPhone,
      transactionPin,
    );
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

export async function listNotifications(
  token: string,
  limit?: number,
): Promise<{ items: ApiNotificationItem[] }> {
  if (USE_MOCK_API) return mock.mockListNotifications(token, limit);
  const q =
    limit != null && Number.isFinite(limit)
      ? `?limit=${encodeURIComponent(String(limit))}`
      : "";
  return request(`/me/notifications${q}`, { token });
}

export async function markNotificationRead(
  token: string,
  id: string,
): Promise<{ ok: boolean }> {
  if (USE_MOCK_API) return mock.mockMarkNotificationRead(token, id);
  return request(`/me/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
    token,
  });
}

export async function listTransactions(
  token: string,
): Promise<{ items: TransactionItem[] }> {
  if (USE_MOCK_API) return mock.mockListTransactions(token);
  return request("/transactions", { token });
}
