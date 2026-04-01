import { API_BASE_URL, USE_MOCK_API } from "../config";
import type { ApiUser, TransactionItem } from "./types";
import { ApiError } from "./errors";
import * as mock from "./mockBackend";

export { ApiError } from "./errors";

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers: hdr, ...rest } = options;
  const headers = new Headers(hdr);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
  });
  const data = await parseJson(res);
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : res.statusText;
    throw new ApiError(msg || "Erreur réseau", res.status, data);
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
): Promise<{ token: string; user: ApiUser }> {
  if (USE_MOCK_API) return mock.mockVerifyOtp(phoneDigits, code);
  return request("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phone: phoneDigits, code }),
  });
}

export async function getMe(token: string): Promise<ApiUser> {
  if (USE_MOCK_API) return mock.mockGetMe(token);
  return request("/me", { token });
}

export async function deposit(
  token: string,
  amount: number,
): Promise<{ balanceFcfa: number }> {
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
): Promise<{ balanceFcfa: number }> {
  if (USE_MOCK_API) return mock.mockPay(token, amount, recipientName, recipientPhone);
  return request("/payments/pay", {
    method: "POST",
    token,
    body: JSON.stringify({ amount, recipientName, recipientPhone }),
  });
}

export async function listTransactions(
  token: string,
): Promise<{ items: TransactionItem[] }> {
  if (USE_MOCK_API) return mock.mockListTransactions(token);
  return request("/transactions", { token });
}
