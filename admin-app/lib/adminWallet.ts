import { api } from "./api";

export type AdminUserSummary = {
  userId: string;
  accountId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  balanceFcfa: number;
  payBlocked?: boolean;
  isMerchant?: boolean;
};

export type UserDetail = {
  balanceFcfa: number;
  profile: {
    userId: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    accountId?: string;
  };
};

type ElevationCache = { token: string; until: number } | null;
let elevationCache: ElevationCache = null;

export function clearElevationCache() {
  elevationCache = null;
}

export function rememberElevation(token: string, expiresInSec: number) {
  elevationCache = {
    token,
    until: Date.now() + Math.max(30, expiresInSec - 10) * 1000,
  };
}

export async function listAdminUsers(query: string) {
  const q = encodeURIComponent(query.trim());
  return api<{ users: AdminUserSummary[]; total: number }>(`/api/users?q=${q}`);
}

export async function getAdminUserDetail(userId: string) {
  return api<UserDetail>(`/api/users/${encodeURIComponent(userId)}`);
}

export async function requestElevation(password: string, totp: string) {
  const data = await api<{ elevation: string; expiresInSec: number }>("/api/elevate", {
    method: "POST",
    body: { password, totp },
  });
  elevationCache = {
    token: data.elevation,
    until: Date.now() + Math.max(30, data.expiresInSec - 10) * 1000,
  };
  return data.elevation;
}

async function ensureElevation() {
  if (elevationCache && Date.now() < elevationCache.until) {
    return elevationCache.token;
  }
  const { unlockWithDevice } = await import("./api");
  const data = await unlockWithDevice();
  return data.elevation;
}

export function newIdempotencyKey() {
  const part = Math.random().toString(36).slice(2, 12);
  return `adm-${Date.now().toString(36)}-${part}`.slice(0, 80);
}

export type BalanceDirection = "credit" | "debit";

export function planBalanceChange(
  currentBalance: number,
  mode: "add" | "remove" | "set",
  amountInput: number,
): { direction: BalanceDirection; amountFcfa: number } | null {
  const amount = Math.floor(amountInput);
  if (mode === "add") {
    if (amount < 1) return null;
    return { direction: "credit", amountFcfa: amount };
  }
  if (mode === "remove") {
    if (amount < 1) return null;
    return { direction: "debit", amountFcfa: amount };
  }
  const target = Math.floor(amountInput);
  if (target < 0) return null;
  const delta = target - Math.floor(currentBalance);
  if (delta === 0) return null;
  if (delta > 0) return { direction: "credit", amountFcfa: delta };
  return { direction: "debit", amountFcfa: -delta };
}

export async function confirmMoneyRequest(requestId: string) {
  const path = `/api/money-requests/${encodeURIComponent(requestId)}/confirm`;
  let elevation = await ensureElevation();
  try {
    return await api<{ ok: boolean; item?: { balanceAfterFcfa?: number } }>(path, {
      method: "POST",
      body: {},
      elevation,
    });
  } catch (e: any) {
    if (e?.code === "ELEVATION_REQUIRED" || e?.status === 403) {
      elevationCache = null;
      elevation = await ensureElevation();
      return api(path, { method: "POST", body: {}, elevation });
    }
    throw e;
  }
}

export async function rejectMoneyRequest(requestId: string) {
  const path = `/api/money-requests/${encodeURIComponent(requestId)}/reject`;
  let elevation = await ensureElevation();
  try {
    return await api(path, { method: "POST", body: {}, elevation });
  } catch (e: any) {
    if (e?.code === "ELEVATION_REQUIRED" || e?.status === 403) {
      elevationCache = null;
      elevation = await ensureElevation();
      return api(path, { method: "POST", body: {}, elevation });
    }
    throw e;
  }
}

export async function adjustUserBalance(params: {
  userId: string;
  direction: BalanceDirection;
  amountFcfa: number;
  reason?: string;
  idempotencyKey: string;
}) {
  const reason = (params.reason ?? "Recharge").trim();
  let elevation = await ensureElevation();
  try {
    return await api<{
      ok: boolean;
      balanceAfterFcfa: number;
      balanceBeforeFcfa?: number;
      reused?: boolean;
    }>(`/api/users/${encodeURIComponent(params.userId)}/balance`, {
      method: "POST",
      body: {
        direction: params.direction,
        amountFcfa: params.amountFcfa,
        reason,
        idempotencyKey: params.idempotencyKey,
      },
      elevation,
    });
  } catch (e: any) {
    if (e?.code === "ELEVATION_REQUIRED" || e?.status === 403) {
      elevationCache = null;
      elevation = await ensureElevation();
      return api(`/api/users/${encodeURIComponent(params.userId)}/balance`, {
        method: "POST",
        body: {
          direction: params.direction,
          amountFcfa: params.amountFcfa,
        reason,
        idempotencyKey: params.idempotencyKey,
      },
      elevation,
    });
    }
    throw e;
  }
}

export function userLabel(u: Pick<AdminUserSummary, "firstName" | "lastName" | "phone">) {
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return name || u.phone || "Utilisateur";
}