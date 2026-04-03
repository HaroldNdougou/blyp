import { ApiError } from "./errors";
import type { ApiUser, TransactionItem } from "./types";

function normalizeCameroonPhone(raw: string): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 9) return null;
  const last9 = d.slice(-9);
  if (!/^6\d{8}$/.test(last9)) return null;
  return `+237${last9}`;
}

let pendingOtpPhone: string | null = null;
let sessionToken: string | null = null;
let sessionPhone: string | null = null;
let balanceFcfa = 0;
let transactions: TransactionItem[] = [];
let mockHelloSeq = 0;

function assertSession(token: string) {
  if (!sessionToken || token !== sessionToken) {
    throw new ApiError("Non autorisé", 401);
  }
}

export function mockRequestOtp(phoneDigits: string): { ok: boolean } {
  const phone = normalizeCameroonPhone(phoneDigits);
  if (!phone) {
    throw new ApiError("Numéro invalide (9 chiffres commençant par 6)", 400);
  }
  pendingOtpPhone = phone;
  return { ok: true };
}

export function mockVerifyOtp(
  phoneDigits: string,
  code: string,
): { token: string; user: ApiUser } {
  const phone = normalizeCameroonPhone(phoneDigits);
  const clean = code.replace(/\D/g, "");
  if (!phone || clean.length !== 6) {
    throw new ApiError("Téléphone ou code invalide", 400);
  }
  if (!pendingOtpPhone || phone !== pendingOtpPhone) {
    throw new ApiError("Demandez d’abord un code pour ce numéro", 400);
  }
  pendingOtpPhone = null;
  sessionPhone = phone;
  sessionToken = `blyp-mock-${Date.now()}`;
  return {
    token: sessionToken,
    user: { phone, balanceFcfa },
  };
}

export function mockGetMe(token: string): ApiUser {
  assertSession(token);
  return { phone: sessionPhone!, balanceFcfa };
}

export function mockDeposit(
  token: string,
  amount: number,
): { balanceFcfa: number } {
  assertSession(token);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Montant invalide", 400);
  }
  balanceFcfa += amount;
  const row: TransactionItem = {
    id: `mock-${Date.now()}-d`,
    type: "received",
    amountFcfa: amount,
    counterpartyName: "Rechargement",
    counterpartyPhone: null,
    createdAt: new Date().toISOString(),
  };
  transactions = [row, ...transactions];
  return { balanceFcfa };
}

export function mockPay(
  token: string,
  amount: number,
  recipientName: string,
  recipientPhone: string | null,
): { balanceFcfa: number } {
  assertSession(token);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Montant invalide", 400);
  }
  if (balanceFcfa < amount) {
    throw new ApiError("Solde insuffisant", 400);
  }
  balanceFcfa -= amount;
  const row: TransactionItem = {
    id: `mock-${Date.now()}-p`,
    type: "sent",
    amountFcfa: amount,
    counterpartyName: recipientName,
    counterpartyPhone: recipientPhone,
    createdAt: new Date().toISOString(),
  };
  transactions = [row, ...transactions];
  return { balanceFcfa };
}

export function mockListTransactions(token: string): { items: TransactionItem[] } {
  assertSession(token);
  return { items: [...transactions] };
}

export function mockHealth(): boolean {
  return true;
}

export function mockSayHello(): {
  ok: boolean;
  id: string;
  createdAt: string;
} {
  mockHelloSeq += 1;
  return {
    ok: true,
    id: `mock-hello-${mockHelloSeq}`,
    createdAt: new Date().toISOString(),
  };
}
