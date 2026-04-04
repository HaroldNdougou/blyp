import { ApiError } from "./errors";
import type {
  ApiNotificationItem,
  ApiToastPayload,
  ApiUser,
  OnboardingStep,
  TransactionItem,
} from "./types";

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
/** PIN mock (clair en mémoire — uniquement mode démo). */
let mockTransactionPinPlain: string | null = null;
let mockFirstName: string | null = null;
let mockLastName: string | null = null;
let balanceFcfa = 0;
let transactions: TransactionItem[] = [];
let mockHelloSeq = 0;
const mockNotifications: ApiNotificationItem[] = [];
const lastMockOtpAtByPhone = new Map<string, number>();
const MOCK_OTP_RESEND_MS = 60_000;

function assertSession(token: string) {
  if (!sessionToken || token !== sessionToken) {
    throw new ApiError("Non autorisé", 401);
  }
}

function mockUserFromState(): ApiUser {
  const phone = sessionPhone!;
  const needsPin = mockTransactionPinPlain == null;
  const needsNames =
    !mockFirstName?.trim() ||
    mockFirstName.trim().length < 2 ||
    !mockLastName?.trim() ||
    mockLastName.trim().length < 2;
  const needsOnboarding = needsPin || needsNames;
  const onboardingStep: OnboardingStep | null = needsPin
    ? "pin"
    : needsNames
      ? "profile"
      : null;
  return {
    phone,
    balanceFcfa,
    needsOnboarding,
    onboardingStep,
    firstName: mockFirstName,
    lastName: mockLastName,
  };
}

export function mockRequestOtp(phoneDigits: string): { ok: boolean } {
  const phone = normalizeCameroonPhone(phoneDigits);
  if (!phone) {
    throw new ApiError("Numéro invalide (9 chiffres commençant par 6)", 400);
  }
  const now = Date.now();
  const prev = lastMockOtpAtByPhone.get(phone);
  if (prev != null && now - prev < MOCK_OTP_RESEND_MS) {
    const retryAfterSeconds = Math.ceil(
      (MOCK_OTP_RESEND_MS - (now - prev)) / 1000,
    );
    throw new ApiError(
      "Un nouveau code ne peut être envoyé que toutes les 60 secondes. Réessayez dans un instant.",
      429,
      { retryAfterSeconds },
    );
  }
  lastMockOtpAtByPhone.set(phone, now);
  pendingOtpPhone = phone;
  return { ok: true };
}

export function mockVerifyOtp(
  phoneDigits: string,
  code: string,
): { token: string; user: ApiUser; isNewAccount: boolean } {
  const phone = normalizeCameroonPhone(phoneDigits);
  const clean = code.replace(/\D/g, "");
  if (!phone || clean.length !== 6) {
    throw new ApiError("Téléphone ou code invalide", 400);
  }
  if (!pendingOtpPhone || phone !== pendingOtpPhone) {
    throw new ApiError("Demandez d’abord un code pour ce numéro", 400);
  }
  pendingOtpPhone = null;
  const isNewAccount = sessionPhone !== phone;
  sessionPhone = phone;
  sessionToken = `blyp-mock-${Date.now()}`;
  mockTransactionPinPlain = null;
  mockFirstName = null;
  mockLastName = null;
  return {
    token: sessionToken,
    user: mockUserFromState(),
    isNewAccount,
  };
}

export function mockGetMe(token: string): ApiUser {
  assertSession(token);
  return mockUserFromState();
}

export function mockSetOnboardingTransactionPin(
  token: string,
  pin: string,
): { user: ApiUser } {
  assertSession(token);
  const d = String(pin ?? "").replace(/\D/g, "");
  if (d.length !== 4) {
    throw new ApiError("Le code PIN doit comporter 4 chiffres", 400);
  }
  if (mockTransactionPinPlain != null) {
    throw new ApiError("Code PIN déjà défini", 400);
  }
  mockTransactionPinPlain = d;
  return { user: mockUserFromState() };
}

function pushMockToast(payload: Omit<ApiToastPayload, "id">): ApiToastPayload {
  const id = `mock-n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const full: ApiToastPayload = { id, ...payload };
  mockNotifications.unshift({
    id: full.id,
    kind: full.kind,
    title: full.title,
    body: full.body,
    emoji: full.emoji,
    read: false,
    createdAt: new Date().toISOString(),
  });
  return full;
}

export function mockSetOnboardingProfile(
  token: string,
  firstName: string,
  lastName: string,
): { user: ApiUser; toast?: ApiToastPayload } {
  assertSession(token);
  const f = String(firstName ?? "").trim();
  const l = String(lastName ?? "").trim();
  if (f.length < 2 || l.length < 2) {
    throw new ApiError("Prénom et nom : au moins 2 caractères chacun", 400);
  }
  if (mockTransactionPinPlain == null) {
    throw new ApiError("Définissez d’abord votre code PIN de transaction", 400);
  }
  const wasMissing =
    !mockFirstName?.trim() ||
    mockFirstName.trim().length < 2 ||
    !mockLastName?.trim() ||
    mockLastName.trim().length < 2;
  mockFirstName = f;
  mockLastName = l;
  const toast = wasMissing
    ? pushMockToast({
        kind: "onboarding_welcome",
        title: "Bienvenue sur Blyp",
        body: f ? `${f}, votre compte est prêt.` : "Votre inscription est terminée.",
        emoji: "🎉",
      })
    : undefined;
  return { user: mockUserFromState(), ...(toast ? { toast } : {}) };
}

export function mockDeposit(
  token: string,
  amount: number,
): {
  balanceFcfa: number;
  transactionId?: string;
  toast?: ApiToastPayload;
} {
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
  const toast = pushMockToast({
    kind: "wallet_deposit",
    title: "Solde crédité",
    body: `+${Math.round(amount).toLocaleString("fr-FR")} FCFA sur votre compte.`,
    emoji: "💰",
  });
  return { balanceFcfa, transactionId: row.id, toast };
}

export function mockPay(
  token: string,
  amount: number,
  recipientName: string,
  recipientPhone: string | null,
  transactionPin: string,
): { balanceFcfa: number; toast?: ApiToastPayload } {
  assertSession(token);
  const pin = String(transactionPin ?? "").replace(/\D/g, "");
  if (pin.length !== 4) {
    throw new ApiError("Code PIN de transaction requis (4 chiffres)", 400);
  }
  if (mockTransactionPinPlain == null) {
    throw new ApiError("Complétez votre inscription (code PIN) pour payer", 403);
  }
  if (pin !== mockTransactionPinPlain) {
    throw new ApiError("Code PIN incorrect", 400);
  }
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
  const who = String(recipientName ?? "").trim().slice(0, 80) || "Bénéficiaire";
  const toast = pushMockToast({
    kind: "payment_sent",
    title: "Paiement envoyé",
    body: `${Math.round(amount).toLocaleString("fr-FR")} FCFA envoyés à ${who}`,
    emoji: "✅",
  });
  return { balanceFcfa, toast };
}

export function mockListTransactions(token: string): { items: TransactionItem[] } {
  assertSession(token);
  return { items: [...transactions] };
}

export function mockHealth(): boolean {
  return true;
}

export function mockListNotifications(
  _token: string,
  limit?: number,
): { items: ApiNotificationItem[] } {
  assertSession(_token);
  const n =
    limit != null && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 30;
  return { items: mockNotifications.slice(0, n) };
}

export function mockMarkNotificationRead(
  token: string,
  id: string,
): { ok: boolean } {
  assertSession(token);
  const row = mockNotifications.find((x) => x.id === id);
  if (row) row.read = true;
  return { ok: true };
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
