import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  setAuthSession,
} from "@/lib/auth/authSession";
import i18n from "@/lib/i18n";
import { API_BASE_URL, USE_MOCK_API } from "../config";
import { ApiError } from "./errors";
import type {
  ApiUser,
  TransactionItem,
  WalletDepositResponse,
  WalletDepositStatusResponse,
} from "./types";

export {
  ApiError,
  API_ERROR_TRANSACTION_PIN_INVALID,
  isTransactionPinInvalidError,
} from "./errors";

/** Chargé à la demande : en prod (`USE_MOCK_API` false) le parse/execute au cold start évite tout le mock. */
function loadMock() {
  return import("./mockBackend");
}

/** Message court affiché quand `fetch` échoue (pas une erreur JSON du serveur). */
function networkUnreachableMessage(cause: unknown): string {
  const hint = i18n.t("network.requestFailedHint");
  const base = i18n.t("network.requestFailed");
  if (__DEV__ && cause instanceof Error && cause.message) {
    return `${base}\n\n${hint}\n\n${cause.message}`;
  }
  return `${base}\n\n${hint}`;
}

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

function readJwtExpMs(accessToken: string): number | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "===".slice((b64.length + 3) % 4);
    const atobFn = globalThis.atob;
    if (typeof atobFn !== "function") return null;
    const json = atobFn(pad);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Un seul refresh à la fois — évite rotation concurrente (famille révoquée côté AWS). */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rafraîchit access (+ refresh si rotation) ; met à jour le stockage sécurisé.
 * Appelé depuis `request` sur 401, sans repasser par `request` (évite boucle).
 */
async function refreshSessionTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
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
      /** Réseau / timeout : ne jamais effacer — l’utilisateur garde sa session locale. */
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearAuthSession();
      }
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Au cold start : renouvelle l’access si bientôt expiré / absent (refresh 180 j).
 * Ne déconnecte pas sur simple erreur réseau.
 */
export async function ensureSessionFresh(): Promise<boolean> {
  const access = getAccessToken();
  const refresh = getRefreshToken();
  if (!access && !refresh) return false;
  if (!refresh) return Boolean(access);
  const expMs = access ? readJwtExpMs(access) : null;
  const renewIfWithinMs = 2 * 60 * 1000;
  if (!access || expMs == null || expMs <= Date.now() + renewIfWithinMs) {
    return refreshSessionTokens();
  }
  return true;
}

function errorMessageFromResponse(_res: Response, data: unknown): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    const msg = String((data as { error?: unknown }).error ?? "").trim();
    if (
      msg &&
      !/^réponse http \d+/i.test(msg) &&
      !/^session invalide$/i.test(msg)
    ) {
      return msg;
    }
  }
  return "Une erreur est survenue.";
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
    throw new ApiError(networkUnreachableMessage(cause), 0);
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
  idempotencyKey: string,
  options?: {
    /** MSISDN sans + : 9 chiffres 6XXXXXXXX ou 237… (sandbox PawaPay). */
    payerPhone?: string;
    /** MTN_MOMO_CMR | ORANGE_CMR */
    mmProvider?: string;
  },
): Promise<WalletDepositResponse> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockDeposit(token, amount, idempotencyKey);
  }
  return request<WalletDepositResponse>("/wallet/deposit", {
    method: "POST",
    token,
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      amount,
      ...(options?.payerPhone?.trim()
        ? { payerPhone: options.payerPhone.trim() }
        : {}),
      ...(options?.mmProvider?.trim()
        ? { mmProvider: options.mmProvider.trim() }
        : {}),
    }),
  });
}

export async function getDepositIntentStatus(
  token: string,
  depositIntentId: string,
  opts?: {
    /**
     * false = lecture Dynamo seule (rapide, suit le webhook).
     * true = peut appeler PawaPay si encore pending (défaut).
     */
    syncRemote?: boolean;
  },
): Promise<WalletDepositStatusResponse> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockGetDepositIntentStatus(
      token,
      depositIntentId,
    );
  }
  const syncQ = opts?.syncRemote === false ? "?sync=0" : "";
  return request<WalletDepositStatusResponse>(
    `/wallet/deposits/${encodeURIComponent(depositIntentId)}${syncQ}`,
    { token },
  );
}

export async function pay(
  token: string,
  amount: number,
  recipientName: string,
  recipientPhone: string | null,
  transactionPin: string,
  recipientAccountId?: string | null,
): Promise<{
  balanceFcfa: number;
  transactionId: string | null;
  reference: string | null;
}> {
  if (USE_MOCK_API) {
    const m = await loadMock();
    return m.mockPay(
      token,
      amount,
      recipientName,
      recipientPhone,
      transactionPin,
      recipientAccountId,
    );
  }
  return request("/payments/pay", {
    method: "POST",
    token,
    body: JSON.stringify({
      amount,
      recipientName,
      recipientPhone,
      recipientAccountId,
      transactionPin,
    }),
  });
}

export async function createCommerce(
  token: string,
  input: { name: string; category?: string; phone?: string },
): Promise<{ commerce: import("./types").ApiCommerce; user: ApiUser }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockCreateCommerce(token, input);
  }
  return request("/commerces", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function listCommerces(
  token: string,
): Promise<{ items: import("./types").ApiCommerce[] }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockListCommerces(token);
  }
  return request("/commerces", { token });
}

/** Lookup nom public (commerce / prénom) — GetItem ciblé, pour libellé BLE. */
export async function lookupAccountPublic(
  token: string,
  accountId: string,
): Promise<{ accountId: string; displayName: string; kind: string }> {
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  if (USE_MOCK_API) {
    return (await loadMock()).mockLookupAccountPublic(token, id);
  }
  return request(
    `/accounts/${encodeURIComponent(id)}/public`,
    { token },
  );
}

export async function setActiveContext(
  token: string,
  input:
    | { type: "personal" }
    | { type: "commerce"; commerceId: string },
): Promise<{ user: ApiUser }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSetActiveContext(token, input);
  }
  return request("/me/context", {
    method: "PUT",
    token,
    body: JSON.stringify(input),
  });
}

export async function registerDeviceToken(
  token: string,
  input: { token: string; platform: string; deviceId?: string },
): Promise<{ ok: boolean }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockRegisterDeviceToken(token, input);
  }
  return request("/me/device-token", {
    method: "PUT",
    token,
    body: JSON.stringify(input),
  });
}

export async function unregisterDeviceToken(
  token: string,
  input: { token?: string; deviceId?: string },
): Promise<{ ok: boolean }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockUnregisterDeviceToken(token, input);
  }
  return request("/me/device-token", {
    method: "DELETE",
    token,
    body: JSON.stringify(input),
  });
}

export async function listTransactions(
  token: string,
  opts?: { since?: string | null },
): Promise<{
  items: TransactionItem[];
  cursor?: string | null;
  delta?: boolean;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockListTransactions(token, opts?.since);
  }
  const q =
    opts?.since != null && opts.since !== ""
      ? `?since=${encodeURIComponent(opts.since)}`
      : "";
  return request(`/transactions${q}`, { token });
}

export async function listConversations(
  token: string,
): Promise<{ items: import("./types").Conversation[] }> {
  if (USE_MOCK_API) return (await loadMock()).mockListConversations(token);
  return request("/conversations", { token });
}

export async function openConversation(
  token: string,
  phone: string,
): Promise<{ conversation: import("./types").Conversation }> {
  if (USE_MOCK_API) return (await loadMock()).mockOpenConversation(token, phone);
  return request("/conversations", {
    method: "POST",
    token,
    body: JSON.stringify({ phone }),
  });
}

export async function listMessages(
  token: string,
  conversationId: string,
): Promise<{ items: import("./types").ChatMessage[] }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockListMessages(token, conversationId);
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { token },
  );
}

export async function sendTextMessage(
  token: string,
  conversationId: string,
  body: string,
  clientId: string,
): Promise<{ message: import("./types").ChatMessage }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSendTextMessage(
      token,
      conversationId,
      body,
      clientId,
    );
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "text", body, clientId }),
    },
  );
}

export async function sendMoneyMessage(
  token: string,
  conversationId: string,
  amount: number,
  clientId: string,
  idempotencyKey: string,
  transactionPin: string,
): Promise<{
  message: import("./types").ChatMessage;
  balanceFcfa: number;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSendMoneyMessage(
      token,
      conversationId,
      amount,
      clientId,
      idempotencyKey,
      transactionPin,
    );
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        type: "money",
        amount,
        clientId,
        idempotencyKey,
        transactionPin,
      }),
    },
  );
}

export async function claimMoneyTransfer(
  token: string,
  transferId: string,
): Promise<{
  transfer: import("./types").MoneyTransfer;
  balanceFcfa: number;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockClaimMoneyTransfer(token, transferId);
  }
  return request(
    `/money-transfers/${encodeURIComponent(transferId)}/claim`,
    { method: "POST", token },
  );
}
