import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  setAuthSession,
} from "@/lib/auth/authSession";
import i18n from "@/lib/i18n";
import {
  demoApiResponse,
  isDemoPath,
  withDemoConversations,
} from "@/lib/dev/demoProfiles";
import { withNormalizedReplyTo } from "@/lib/messages/replyPreview";
import { API_BASE_URL, USE_MOCK_API } from "../config";
import { ApiError } from "./errors";
import type {
  ApiUser,
  Pocket,
  PocketMoveResponse,
  PocketTransaction,
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
  if (typeof data === "object" && data !== null) {
    const o = data as { error?: unknown; message?: unknown };
    const fromError = String(o.error ?? "").trim();
    const fromMessage = String(o.message ?? "").trim();
    const msg = fromError || fromMessage;
    if (msg && !/^internal server error$/i.test(msg)) {
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
  if (isDemoPath(path)) {
    return demoApiResponse<T>(path, rest.method ?? "GET", rest.body, token);
  }
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

export async function presignProfileAvatar(
  token: string,
  contentType: string,
): Promise<{
  uploadUrl: string;
  key: string;
  contentType: string;
  expiresIn: number;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockPresignProfileAvatar(token, contentType);
  }
  return request("/me/avatar/presign", {
    method: "POST",
    token,
    body: JSON.stringify({ contentType }),
  });
}

export async function confirmProfileAvatar(
  token: string,
  key: string,
): Promise<{ user: ApiUser }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockConfirmProfileAvatar(token, key);
  }
  return request("/me/avatar/confirm", {
    method: "POST",
    token,
    body: JSON.stringify({ key }),
  });
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
): Promise<{
  accountId: string;
  displayName: string;
  kind: string;
  category?: string | null;
}> {
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

export async function listPockets(
  token: string,
): Promise<{ items: Pocket[] }> {
  if (USE_MOCK_API) return (await loadMock()).mockListPockets(token);
  return request("/pockets", { token });
}

export async function createPocket(
  token: string,
  input: { name: string; initialAmount?: number },
  idempotencyKey: string,
): Promise<PocketMoveResponse> {
  if (USE_MOCK_API) return (await loadMock()).mockCreatePocket(token, input);
  return request("/pockets", {
    method: "POST",
    token,
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export async function movePocketFunds(
  token: string,
  pocketId: string,
  direction: "in" | "out",
  amount: number,
  idempotencyKey: string,
): Promise<PocketMoveResponse> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockMovePocketFunds(token, pocketId, direction, amount);
  }
  return request(`/pockets/${encodeURIComponent(pocketId)}/move`, {
    method: "POST",
    token,
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ direction, amount }),
  });
}

export async function renamePocket(
  token: string,
  pocketId: string,
  name: string,
): Promise<{ pocket: Pocket | null }> {
  if (USE_MOCK_API) return (await loadMock()).mockRenamePocket(token, pocketId, name);
  return request(`/pockets/${encodeURIComponent(pocketId)}`, {
    method: "PUT",
    token,
    body: JSON.stringify({ name }),
  });
}

export async function deletePocket(
  token: string,
  pocketId: string,
): Promise<{ ok: boolean; balanceFcfa: number }> {
  if (USE_MOCK_API) return (await loadMock()).mockDeletePocket(token, pocketId);
  return request(`/pockets/${encodeURIComponent(pocketId)}`, {
    method: "DELETE",
    token,
  });
}

export async function listPocketTransactions(
  token: string,
  pocketId: string,
): Promise<{ items: PocketTransaction[] }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockListPocketTransactions(token, pocketId);
  }
  return request(`/pockets/${encodeURIComponent(pocketId)}/transactions`, {
    token,
  });
}

export async function listConversations(
  token: string,
): Promise<{ items: import("./types").Conversation[] }> {
  if (USE_MOCK_API) return (await loadMock()).mockListConversations(token);
  const data = await request<{ items: import("./types").Conversation[] }>(
    "/conversations",
    { token },
  );
  return { ...data, items: withDemoConversations(data.items ?? []) };
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

export async function lookupBlypPhones(
  token: string,
  phones: string[],
): Promise<{ items: import("./types").BlypPhoneLookupItem[] }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockLookupBlypPhones(token, phones);
  }
  return request("/contacts/blyp-lookup", {
    method: "POST",
    token,
    body: JSON.stringify({ phones }),
  });
}

export async function listMessages(
  token: string,
  conversationId: string,
): Promise<{
  items: import("./types").ChatMessage[];
  peerLastReadAt?: string | null;
  peerLastDeliveredAt?: string | null;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockListMessages(token, conversationId);
  }
  const data = await request<{
    items?: import("./types").ChatMessage[];
    messages?: import("./types").ChatMessage[];
    peerLastReadAt?: string | null;
    peerLastDeliveredAt?: string | null;
  }>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    token,
  });
  const raw = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.messages)
      ? data.messages
      : [];
  const items = raw.map((m) => {
    const id = String(
      m.id || (m as { messageId?: string }).messageId || "",
    ).trim();
    return withNormalizedReplyTo({ ...m, id });
  });
  return {
    items,
    peerLastReadAt: data.peerLastReadAt ?? null,
    peerLastDeliveredAt: data.peerLastDeliveredAt ?? null,
  };
}

export async function markConversationRead(
  token: string,
  conversationId: string,
): Promise<{ ok: boolean; at?: string }> {
  if (USE_MOCK_API) return { ok: true, at: new Date().toISOString() };
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "read" }),
    },
  );
}

export async function markConversationDelivered(
  token: string,
  conversationId: string,
): Promise<{ ok: boolean; at?: string }> {
  if (USE_MOCK_API) return { ok: true, at: new Date().toISOString() };
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "delivered" }),
    },
  );
}

export async function presignVoiceUpload(
  token: string,
  conversationId: string,
): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
  if (USE_MOCK_API) {
    return {
      uploadUrl: "mock://voice",
      key: `voice/${conversationId}/me/mock.m4a`,
      expiresIn: 300,
    };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "voice-presign" }),
    },
  );
}

export async function presignVoicePlay(
  token: string,
  conversationId: string,
  key: string,
): Promise<{ url: string; expiresIn?: number }> {
  if (USE_MOCK_API) {
    return { url: key, expiresIn: 600 };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "voice-play", key }),
    },
  );
}

export async function sendVoiceMessage(
  token: string,
  conversationId: string,
  key: string,
  durationMs: number,
  clientId: string,
  replyToMessageId?: string | null,
): Promise<{ message: import("./types").ChatMessage }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSendVoiceMessage(
      token,
      conversationId,
      key,
      durationMs,
      clientId,
      replyToMessageId,
    );
  }
  const payload: Record<string, unknown> = {
    type: "voice",
    key,
    durationMs,
    clientId,
  };
  const replyId = String(replyToMessageId ?? "").trim();
  if (replyId) payload.replyToMessageId = replyId;
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    },
  );
}

export async function presignImageUpload(
  token: string,
  conversationId: string,
  contentType?: string,
): Promise<{
  uploadUrl: string;
  key: string;
  contentType: string;
  expiresIn: number;
}> {
  if (USE_MOCK_API) {
    return {
      uploadUrl: "mock://image",
      key: `image/${conversationId}/me/mock.jpg`,
      contentType: "image/jpeg",
      expiresIn: 300,
    };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({
        type: "image-presign",
        contentType: contentType ?? "image/jpeg",
      }),
    },
  );
}

export async function presignImagePlay(
  token: string,
  conversationId: string,
  key: string,
): Promise<{ url: string; expiresIn?: number }> {
  if (USE_MOCK_API) {
    return { url: key, expiresIn: 600 };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "image-play", key }),
    },
  );
}

export async function sendImageMessage(
  token: string,
  conversationId: string,
  key: string,
  width: number,
  height: number,
  clientId: string,
  caption?: string | null,
  replyToMessageId?: string | null,
): Promise<{ message: import("./types").ChatMessage }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSendImageMessage(
      token,
      conversationId,
      key,
      width,
      height,
      clientId,
      caption,
      replyToMessageId,
    );
  }
  const cap = String(caption ?? "").trim();
  const payload: Record<string, unknown> = {
    type: "image",
    key,
    width,
    height,
    clientId,
    caption: cap || undefined,
  };
  const replyId = String(replyToMessageId ?? "").trim();
  if (replyId) payload.replyToMessageId = replyId;
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    },
  );
}

export async function presignDocumentUpload(
  token: string,
  conversationId: string,
  contentType: string,
  fileName: string,
): Promise<{
  uploadUrl: string;
  key: string;
  contentType: string;
  expiresIn: number;
}> {
  if (USE_MOCK_API) {
    return {
      uploadUrl: "mock://document",
      key: `doc/${conversationId}/me/mock.pdf`,
      contentType: contentType || "application/pdf",
      expiresIn: 300,
    };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({
        type: "document-presign",
        contentType,
        fileName,
      }),
    },
  );
}

export async function presignDocumentDownload(
  token: string,
  conversationId: string,
  key: string,
): Promise<{ url: string; expiresIn?: number }> {
  if (USE_MOCK_API) {
    return { url: key, expiresIn: 600 };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "document-download", key }),
    },
  );
}

export async function presignDocumentThumbUpload(
  token: string,
  conversationId: string,
): Promise<{
  uploadUrl: string;
  key: string;
  contentType: string;
  expiresIn: number;
}> {
  if (USE_MOCK_API) {
    return {
      uploadUrl: "mock://document-thumb",
      key: `doc-thumb/${conversationId}/me/mock.jpg`,
      contentType: "image/jpeg",
      expiresIn: 300,
    };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "document-thumb-presign" }),
    },
  );
}

export async function presignDocumentThumbDownload(
  token: string,
  conversationId: string,
  key: string,
): Promise<{ url: string; expiresIn?: number }> {
  if (USE_MOCK_API) {
    return { url: key, expiresIn: 600 };
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "document-thumb-download", key }),
    },
  );
}

export async function sendDocumentMessage(
  token: string,
  conversationId: string,
  key: string,
  fileName: string,
  sizeBytes: number,
  contentType: string,
  clientId: string,
  replyToMessageId?: string | null,
  thumbKey?: string | null,
  pageCount?: number | null,
  caption?: string | null,
): Promise<{ message: import("./types").ChatMessage }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSendDocumentMessage(
      token,
      conversationId,
      key,
      fileName,
      sizeBytes,
      contentType,
      clientId,
      replyToMessageId,
      thumbKey,
      pageCount,
      caption,
    );
  }
  const cap = String(caption ?? "").trim();
  const payload: Record<string, unknown> = {
    type: "document",
    key,
    fileName,
    sizeBytes,
    contentType,
    clientId,
  };
  if (cap) payload.caption = cap;
  const thumb = String(thumbKey ?? "").trim();
  if (thumb) payload.thumbKey = thumb;
  const pages = Math.floor(Number(pageCount) || 0);
  if (pages > 0) payload.pageCount = pages;
  const replyId = String(replyToMessageId ?? "").trim();
  if (replyId) payload.replyToMessageId = replyId;
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    },
  );
}

export type DeleteMessageScope = "me" | "everyone";

export async function deleteChatMessage(
  token: string,
  conversationId: string,
  messageId: string,
  scope: DeleteMessageScope,
): Promise<{
  ok: boolean;
  scope: DeleteMessageScope;
  messageId: string;
  message?: import("./types").ChatMessage;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockDeleteChatMessage(
      token,
      conversationId,
      messageId,
      scope,
    );
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "delete", messageId, scope }),
    },
  );
}

export async function reactToMessage(
  token: string,
  conversationId: string,
  messageId: string,
  emoji: string | null,
): Promise<{
  ok: boolean;
  messageId: string;
  reactions: import("./types").MessageReaction[];
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockReactToMessage(
      token,
      conversationId,
      messageId,
      emoji,
    );
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "react", messageId, emoji }),
    },
  );
}

export async function sendTextMessage(
  token: string,
  conversationId: string,
  body: string,
  clientId: string,
  replyToMessageId?: string | null,
): Promise<{ message: import("./types").ChatMessage }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockSendTextMessage(
      token,
      conversationId,
      body,
      clientId,
      replyToMessageId,
    );
  }
  const payload: Record<string, unknown> = {
    type: "text",
    body,
    clientId,
  };
  const replyId = String(replyToMessageId ?? "").trim();
  if (replyId) payload.replyToMessageId = replyId;
  const res = await request<{ message: import("./types").ChatMessage }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    },
  );
  return { message: withNormalizedReplyTo(res.message) };
}

export async function sendMoneyMessage(
  token: string,
  conversationId: string,
  amount: number,
  clientId: string,
  idempotencyKey: string,
  transactionPin: string,
  replyToMessageId?: string | null,
  caption?: string | null,
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
      replyToMessageId,
      caption,
    );
  }
  const cap = String(caption ?? "").trim();
  const payload: Record<string, unknown> = {
    type: "money",
    amount,
    clientId,
    idempotencyKey,
    transactionPin,
  };
  if (cap) payload.caption = cap;
  const replyId = String(replyToMessageId ?? "").trim();
  if (replyId) payload.replyToMessageId = replyId;
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
  );
}

export type MoneyTransferAction = "claim" | "recall";

export async function claimMoneyTransfer(
  token: string,
  transferId: string,
  action: MoneyTransferAction = "claim",
): Promise<{
  transfer: import("./types").MoneyTransfer;
  balanceFcfa: number;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockClaimMoneyTransfer(token, transferId, action);
  }
  return request(
    `/money-transfers/${encodeURIComponent(transferId)}/claim`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ action }),
    },
  );
}

export async function thankMoneyTransfer(
  token: string,
  conversationId: string,
  transferId: string,
): Promise<{
  ok: boolean;
  transfer: import("./types").MoneyTransfer;
}> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockThankMoneyTransfer(
      token,
      conversationId,
      transferId,
    );
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "money-thanks", transferId }),
    },
  );
}

export async function sendConversationTyping(
  token: string,
  conversationId: string,
  on: boolean,
): Promise<{ ok: boolean }> {
  if (USE_MOCK_API) {
    return (await loadMock()).mockMarkConversationTyping(
      token,
      conversationId,
      on,
    );
  }
  return request(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ type: "typing", on }),
    },
  );
}
