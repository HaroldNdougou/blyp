import { makeAccountId, makeCommerceAccountId } from "@/lib/accountId";
import { makeTxReference } from "@/lib/txReference";
import { ApiError, API_ERROR_TRANSACTION_PIN_INVALID } from "./errors";
import type {
  ApiActiveContext,
  ApiCommerce,
  ApiUser,
  ChatMessage,
  CommerceCategory,
  Conversation,
  MoneyTransfer,
  OnboardingStep,
  Pocket,
  PocketMoveResponse,
  PocketTransaction,
  TransactionItem,
  WalletDepositResponse,
  WalletDepositStatusResponse,
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
let sessionRefreshToken: string | null = null;
let sessionPhone: string | null = null;
let mockTransactionPinPlain: string | null = null;
let mockFirstName: string | null = null;
let mockLastName: string | null = null;
let mockSessionUserId: string | null = null;
let balanceFcfa = 0;
let transactions: TransactionItem[] = [];
let mockCommerces: ApiCommerce[] = [];
let mockCommerceTx = new Map<string, TransactionItem[]>();
let mockActiveContext: ApiActiveContext = { type: "personal" };
let mockHelloSeq = 0;
let mockAvatarUri: string | null = null;
const lastMockOtpAtByPhone = new Map<string, number>();
const MOCK_OTP_RESEND_MS = 60_000;
const mockDepositIdempotencyCache = new Map<string, WalletDepositResponse>();
const mockDepositStatusByIntentId = new Map<
  string,
  WalletDepositStatusResponse
>();

function assertSession(token: string) {
  if (!sessionToken || token !== sessionToken) {
    throw new ApiError("Non autorisé", 401);
  }
}

function activeCommerce(): ApiCommerce | null {
  if (mockActiveContext.type !== "commerce") return null;
  const commerceId = mockActiveContext.commerceId;
  return mockCommerces.find((c) => c.id === commerceId) ?? null;
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
  const commerce = activeCommerce();
  return {
    id: commerce?.accountId ?? mockSessionUserId ?? makeAccountId(),
    personalAccountId: mockSessionUserId,
    phone,
    balanceFcfa: commerce ? commerce.balanceFcfa : balanceFcfa,
    personalBalanceFcfa: balanceFcfa,
    needsOnboarding,
    onboardingStep,
    firstName: commerce ? commerce.name : mockFirstName,
    lastName: commerce ? null : mockLastName,
    personalFirstName: mockFirstName,
    personalLastName: mockLastName,
    isMerchant: mockCommerces.length > 0,
    activeContext: commerce
      ? {
          type: "commerce",
          commerceId: commerce.id,
          name: commerce.name,
          accountId: commerce.accountId,
          category: commerce.category,
        }
      : { type: "personal" },
    commerces: mockCommerces.map((c) => ({ ...c })),
    avatarUrl: mockAvatarUri,
  };
}

export function mockStageAvatarLocalUri(uri: string): void {
  mockAvatarUri = String(uri ?? "").trim() || null;
}

export function mockPresignProfileAvatar(
  token: string,
  contentType: string,
): {
  uploadUrl: string;
  key: string;
  contentType: string;
  expiresIn: number;
} {
  assertSession(token);
  const nine = String(sessionPhone ?? "").replace(/\D/g, "").slice(-9);
  const ct = String(contentType ?? "image/jpeg").trim() || "image/jpeg";
  return {
    uploadUrl: "mock://avatar",
    key: `avatars/${nine || "600000000"}.jpg`,
    contentType: ct,
    expiresIn: 300,
  };
}

export function mockConfirmProfileAvatar(
  token: string,
  key: string,
): { user: ApiUser } {
  assertSession(token);
  const nine = String(sessionPhone ?? "").replace(/\D/g, "").slice(-9);
  if (!key.includes(nine || "600000000")) {
    throw new ApiError("Clé avatar invalide", 400);
  }
  return { user: mockUserFromState() };
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
): {
  token: string;
  refreshToken: string;
  user: ApiUser;
  isNewAccount: boolean;
} {
  const phone = normalizeCameroonPhone(phoneDigits);
  const clean = code.replace(/\D/g, "");
  if (!phone || (clean !== "1234" && clean.length !== 6)) {
    throw new ApiError("Téléphone ou code invalide", 400);
  }
  if (!pendingOtpPhone || phone !== pendingOtpPhone) {
    throw new ApiError("Demandez d’abord un code pour ce numéro", 400);
  }
  pendingOtpPhone = null;
  const isNewAccount = sessionPhone !== phone;
  sessionPhone = phone;
  if (isNewAccount || !mockSessionUserId) {
    mockSessionUserId = makeAccountId();
    mockCommerces = [];
    mockCommerceTx = new Map();
    mockActiveContext = { type: "personal" };
    balanceFcfa = 0;
    transactions = [];
  }
  const ts = Date.now();
  sessionToken = `blyp-mock-access-${ts}`;
  sessionRefreshToken = `blyp-mock-refresh-${ts}`;
  mockTransactionPinPlain = null;
  mockFirstName = null;
  mockLastName = null;
  return {
    token: sessionToken,
    refreshToken: sessionRefreshToken,
    user: mockUserFromState(),
    isNewAccount,
  };
}

export function mockRefreshSession(refreshToken: string): {
  token: string;
  refreshToken: string;
} {
  const r = String(refreshToken ?? "").trim();
  if (!sessionRefreshToken || r !== sessionRefreshToken) {
    throw new ApiError("Session expirée. Reconnectez-vous.", 401);
  }
  const ts = Date.now();
  sessionToken = `blyp-mock-access-${ts}`;
  sessionRefreshToken = `blyp-mock-refresh-${ts}`;
  return { token: sessionToken, refreshToken: sessionRefreshToken };
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

export function mockSetOnboardingProfile(
  token: string,
  firstName: string,
  lastName: string,
): { user: ApiUser } {
  assertSession(token);
  const f = String(firstName ?? "").trim();
  const l = String(lastName ?? "").trim();
  if (f.length < 2 || l.length < 2) {
    throw new ApiError("Prénom et nom : au moins 2 caractères chacun", 400);
  }
  if (mockTransactionPinPlain == null) {
    throw new ApiError("Définissez d’abord votre code PIN de transaction", 400);
  }
  mockFirstName = f;
  mockLastName = l;
  return { user: mockUserFromState() };
}

export function mockCreateCommerce(
  token: string,
  input: { name: string; category?: string; phone?: string },
): { commerce: ApiCommerce; user: ApiUser } {
  assertSession(token);
  if (mockTransactionPinPlain == null) {
    throw new ApiError(
      "Terminez l’inscription avant de créer un commerce",
      400,
    );
  }
  const name = String(input?.name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (name.length < 2) {
    throw new ApiError("Nom du commerce trop court", 400);
  }
  if (mockCommerces.length >= 10) {
    throw new ApiError("Limite de commerces atteinte", 400);
  }
  const catRaw = String(input?.category ?? "other").toLowerCase();
  const category = (
    catRaw === "taxi" || catRaw === "shop" || catRaw === "other"
      ? catRaw
      : "other"
  ) as CommerceCategory;
  const phoneDigits =
    String(input?.phone ?? sessionPhone ?? "")
      .replace(/\D/g, "")
      .slice(-9) || null;
  const commerce: ApiCommerce = {
    id: `mock-c-${Date.now()}`,
    accountId: makeCommerceAccountId(),
    name,
    category,
    phoneDigits,
    balanceFcfa: 0,
    createdAt: new Date().toISOString(),
  };
  mockCommerces = [...mockCommerces, commerce];
  mockCommerceTx.set(commerce.id, []);
  mockActiveContext = {
    type: "commerce",
    commerceId: commerce.id,
    name: commerce.name,
    accountId: commerce.accountId,
    category: commerce.category,
  };
  return { commerce, user: mockUserFromState() };
}

export function mockListCommerces(token: string): { items: ApiCommerce[] } {
  assertSession(token);
  return { items: mockCommerces.map((c) => ({ ...c })) };
}

export function mockLookupAccountPublic(
  token: string,
  accountId: string,
): {
  accountId: string;
  displayName: string;
  kind: string;
  category?: string | null;
} {
  assertSession(token);
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  const commerce = mockCommerces.find((c) => c.accountId === id);
  if (commerce) {
    return {
      accountId: commerce.accountId,
      displayName: commerce.name,
      kind: "commerce",
      category: commerce.category,
    };
  }
  if (id === mockSessionUserId && mockFirstName) {
    return {
      accountId: id,
      displayName: mockFirstName,
      kind: "personal",
      category: "taxi",
    };
  }
  throw new ApiError("Compte introuvable", 404);
}

export function mockSetActiveContext(
  token: string,
  input: { type: string; commerceId?: string },
): { user: ApiUser } {
  assertSession(token);
  const type = String(input?.type ?? "personal").toLowerCase();
  if (type === "personal") {
    mockActiveContext = { type: "personal" };
    return { user: mockUserFromState() };
  }
  if (type !== "commerce") {
    throw new ApiError("Contexte invalide", 400);
  }
  const commerceId = String(input?.commerceId ?? "").trim();
  const hit = mockCommerces.find((c) => c.id === commerceId);
  if (!hit) throw new ApiError("Commerce introuvable", 400);
  mockActiveContext = {
    type: "commerce",
    commerceId: hit.id,
    name: hit.name,
    accountId: hit.accountId,
    category: hit.category,
  };
  return { user: mockUserFromState() };
}

export function mockRegisterDeviceToken(
  token: string,
  _input: { token: string; platform: string; deviceId?: string },
): { ok: boolean } {
  assertSession(token);
  return { ok: true };
}

export function mockUnregisterDeviceToken(
  token: string,
  _input: { token?: string; deviceId?: string },
): { ok: boolean } {
  assertSession(token);
  return { ok: true };
}

export function mockDeposit(
  token: string,
  amount: number,
  idempotencyKey: string,
): WalletDepositResponse {
  assertSession(token);
  const idem = String(idempotencyKey ?? "").trim();
  if (!idem) {
    throw new ApiError("Rechargement : identifiant de requête manquant", 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Montant invalide", 400);
  }
  const cacheKey = `${token}|${idem}`;
  const cached = mockDepositIdempotencyCache.get(cacheKey);
  if (cached) return cached;

  balanceFcfa += amount;
  const ts = Date.now();
  const transactionId = `mock-${ts}-d`;
  const reference = makeTxReference("DEPOSIT");
  const depositIntentId = `mock-intent-${ts}`;
  const row: TransactionItem = {
    id: transactionId,
    reference,
    type: "received",
    amountFcfa: amount,
    counterpartyName: "Rechargement",
    counterpartyPhone: null,
    createdAt: new Date().toISOString(),
  };
  transactions = [row, ...transactions];
  const res: WalletDepositResponse = {
    status: "completed",
    balanceFcfa: mockUserFromState().balanceFcfa,
    transactionId,
    reference,
    depositIntentId,
  };
  mockDepositIdempotencyCache.set(cacheKey, res);
  mockDepositStatusByIntentId.set(depositIntentId, {
    status: "completed",
    depositIntentId,
    amountFcfa: amount,
    balanceFcfa: res.balanceFcfa,
    transactionId,
  });
  return res;
}

export function mockGetDepositIntentStatus(
  token: string,
  depositIntentId: string,
): WalletDepositStatusResponse {
  assertSession(token);
  const row = mockDepositStatusByIntentId.get(depositIntentId);
  if (!row) {
    throw new ApiError("Dépôt introuvable", 404);
  }
  return row;
}

export function mockPay(
  token: string,
  amount: number,
  recipientName: string,
  recipientPhone: string | null,
  transactionPin: string,
  recipientAccountId?: string | null,
): {
  balanceFcfa: number;
  transactionId: string | null;
  reference: string | null;
} {
  assertSession(token);
  const pin = String(transactionPin ?? "").replace(/\D/g, "");
  if (pin.length !== 4) {
    throw new ApiError("Code PIN de transaction requis (4 chiffres)", 400);
  }
  if (mockTransactionPinPlain == null) {
    throw new ApiError("Complétez votre inscription (code PIN) pour payer", 403);
  }
  if (pin !== mockTransactionPinPlain) {
    throw new ApiError("Code PIN incorrect", 400, {
      code: API_ERROR_TRANSACTION_PIN_INVALID,
    });
  }
  if (mockActiveContext.type === "commerce") {
    throw new ApiError("Passez en mode perso pour payer", 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Montant invalide", 400);
  }
  if (balanceFcfa < amount) {
    throw new ApiError("Solde insuffisant", 400);
  }
  const accountId = String(recipientAccountId ?? "").trim().toUpperCase();
  if (!accountId) {
    throw new ApiError("Destinataire invalide (accountId requis)", 400);
  }
  if (
    accountId === mockSessionUserId ||
    mockCommerces.some((c) => c.accountId === accountId)
  ) {
    throw new ApiError("Impossible de vous payer vous-même", 400);
  }

  balanceFcfa -= amount;
  const transactionId = `mock-${Date.now()}-p`;
  const reference = makeTxReference("PAYMENT");
  const row: TransactionItem = {
    id: transactionId,
    reference,
    type: "sent",
    amountFcfa: amount,
    counterpartyName: recipientName,
    counterpartyPhone: recipientPhone,
    createdAt: new Date().toISOString(),
  };
  transactions = [row, ...transactions];

  return {
    balanceFcfa: mockUserFromState().balanceFcfa,
    transactionId,
    reference,
  };
}

export function mockListTransactions(
  token: string,
  since?: string | null,
): {
  items: TransactionItem[];
  cursor: string | null;
  delta: boolean;
} {
  assertSession(token);
  const commerce = activeCommerce();
  let items = commerce
    ? [...(mockCommerceTx.get(commerce.id) ?? [])]
    : [...transactions];
  const delta = Boolean(since);
  if (since) {
    const ms = Date.parse(since);
    if (Number.isFinite(ms)) {
      items = items.filter((t) => Date.parse(t.createdAt) > ms);
    }
  }
  const cursor =
    items.length > 0
      ? items.reduce(
          (max, t) => (t.createdAt > max ? t.createdAt : max),
          items[0].createdAt,
        )
      : (since ?? null);
  return { items, cursor, delta };
}

let mockPockets: Pocket[] = [];
const mockPocketTx = new Map<string, PocketTransaction[]>();

function mockPocketLedgerRow(p: Pocket, direction: "in" | "out", amount: number) {
  const now = new Date().toISOString();
  const tx: PocketTransaction = {
    id: `mock-ptx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pocketId: p.id,
    direction,
    amountFcfa: amount,
    createdAt: now,
  };
  mockPocketTx.set(p.id, [tx, ...(mockPocketTx.get(p.id) ?? [])]);
  transactions = [
    {
      id: `mock-${Date.now()}-pk`,
      reference: makeTxReference("PAYMENT"),
      type: direction === "in" ? "sent" : "received",
      kind: direction === "in" ? "POCKET_IN" : "POCKET_OUT",
      amountFcfa: amount,
      counterpartyName: `Poche · ${p.kind === "savings" ? "Épargne personnelle" : p.name}`,
      counterpartyPhone: null,
      createdAt: now,
    },
    ...transactions,
  ];
  return tx;
}

export function mockListPockets(token: string): { items: Pocket[] } {
  assertSession(token);
  return { items: mockPockets.map((p) => ({ ...p })) };
}

export function mockCreatePocket(
  token: string,
  input: { name: string; initialAmount?: number },
): PocketMoveResponse {
  assertSession(token);
  const name = String(input.name ?? "").trim().slice(0, 40);
  if (!name) throw new ApiError("Nom de poche invalide", 400);
  const amount = Math.floor(Number(input.initialAmount) || 0);
  if (amount > balanceFcfa) throw new ApiError("Solde disponible insuffisant", 400);
  const now = new Date().toISOString();
  const pocket: Pocket = {
    id: `mock${Date.now().toString(36)}`,
    name,
    kind: "custom",
    balanceFcfa: amount,
    createdAt: now,
    updatedAt: now,
  };
  mockPockets = [...mockPockets, pocket];
  let tx: PocketTransaction | null = null;
  if (amount > 0) {
    balanceFcfa -= amount;
    tx = mockPocketLedgerRow(pocket, "in", amount);
  }
  return { pocket: { ...pocket }, balanceFcfa, transaction: tx };
}

export function mockMovePocketFunds(
  token: string,
  pocketId: string,
  direction: "in" | "out",
  amount: number,
): PocketMoveResponse {
  assertSession(token);
  let pocket = mockPockets.find((p) => p.id === pocketId);
  if (!pocket && pocketId === "savings" && direction === "in") {
    const now = new Date().toISOString();
    pocket = {
      id: "savings",
      name: "Épargne personnelle",
      kind: "savings",
      balanceFcfa: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockPockets = [...mockPockets, pocket];
  }
  if (!pocket) throw new ApiError("Poche introuvable", 404);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Montant invalide", 400);
  }
  if (direction === "in" && amount > balanceFcfa) {
    throw new ApiError("Solde disponible insuffisant", 400);
  }
  if (direction === "out" && amount > pocket.balanceFcfa) {
    throw new ApiError("Montant supérieur au solde de la poche", 400);
  }
  const delta = direction === "in" ? amount : -amount;
  pocket.balanceFcfa += delta;
  pocket.updatedAt = new Date().toISOString();
  balanceFcfa -= delta;
  const tx = mockPocketLedgerRow(pocket, direction, amount);
  return { pocket: { ...pocket }, balanceFcfa, transaction: tx };
}

export function mockRenamePocket(
  token: string,
  pocketId: string,
  name: string,
): { pocket: Pocket | null } {
  assertSession(token);
  const pocket = mockPockets.find((p) => p.id === pocketId);
  if (!pocket || pocket.kind === "savings") {
    throw new ApiError("Poche introuvable", 404);
  }
  pocket.name = String(name ?? "").trim().slice(0, 40) || pocket.name;
  return { pocket: { ...pocket } };
}

export function mockDeletePocket(
  token: string,
  pocketId: string,
): { ok: boolean; balanceFcfa: number } {
  assertSession(token);
  const pocket = mockPockets.find((p) => p.id === pocketId);
  if (!pocket || pocket.kind === "savings") {
    throw new ApiError("Poche introuvable", 404);
  }
  if (pocket.balanceFcfa > 0) {
    balanceFcfa += pocket.balanceFcfa;
    mockPocketLedgerRow(pocket, "out", pocket.balanceFcfa);
  }
  mockPockets = mockPockets.filter((p) => p.id !== pocketId);
  return { ok: true, balanceFcfa };
}

export function mockListPocketTransactions(
  token: string,
  pocketId: string,
): { items: PocketTransaction[] } {
  assertSession(token);
  return { items: [...(mockPocketTx.get(pocketId) ?? [])] };
}

export function mockHealth(): boolean {
  return true;
}

const mockConversations: Conversation[] = [];
const mockMessages = new Map<string, ChatMessage[]>();
const mockHiddenMessageIds = new Map<string, Set<string>>();
const mockInviteSmsAt = new Map<string, number>();

function mockDirectId(phone: string) {
  return `dm_mock_${phone}`;
}

/** Simule l’invitation SMS (1 / conversation / 24 h) pour un peer sans compte. */
function mockQueuePeerInvite(
  conversationId: string,
  kind: "text" | "voice" | "money" | "image",
) {
  const conv = mockConversations.find((c) => c.id === conversationId);
  if (!conv || conv.peerUserId) return;
  const now = Date.now();
  const last = mockInviteSmsAt.get(conversationId) ?? 0;
  if (now - last < 24 * 60 * 60 * 1000) return;
  mockInviteSmsAt.set(conversationId, now);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log(
      `[mock] invite SMS (${kind}) → ${conv.peerPhone ?? conv.peerName}`,
    );
  }
}

export function mockListConversations(_token: string) {
  return { items: [...mockConversations] };
}

export function mockLookupBlypPhones(
  _token: string,
  phones: string[],
): { items: { phone: string; onBlyp: boolean }[] } {
  const demoOnBlyp = new Set([
    "600000101",
    "600000102",
    "600000103",
    "600000104",
    "600000105",
    "600000106",
    "600000107",
    "600000108",
  ]);
  const items = phones.map((raw) => {
    const s = String(raw).trim();
    const phone = s.startsWith("+")
      ? s
      : `+237${String(raw).replace(/\D/g, "").slice(-9)}`;
    const nine = phone.replace(/\D/g, "").slice(-9);
    return {
      phone,
      onBlyp: demoOnBlyp.has(nine),
    };
  });
  return { items };
}

export function mockOpenConversation(_token: string, phone: string) {
  const digits = String(phone).replace(/\D/g, "").slice(-9);
  const id = mockDirectId(digits);
  let conversation = mockConversations.find((c) => c.id === id);
  if (!conversation) {
    conversation = {
      id,
      type: "direct",
      peerName: `+237${digits}`,
      peerPhone: `+237${digits}`,
      peerUserId: null,
      lastMessagePreview: "",
      lastMessageType: null,
      lastMessageAt: null,
      updatedAt: new Date().toISOString(),
    };
    mockConversations.unshift(conversation);
  }
  return { conversation };
}

function mockReplyToFromList(
  conversationId: string,
  replyToMessageId?: string | null,
): ChatMessage["replyTo"] {
  const replyMid = String(replyToMessageId ?? "").trim();
  if (!replyMid) return null;
  const target = (mockMessages.get(conversationId) ?? []).find(
    (m) => m.id === replyMid,
  );
  if (!target) return null;
  return {
    messageId: target.id,
    senderUserId: target.senderUserId,
    type: target.type,
    preview:
      target.type === "text" || target.type === "image"
        ? target.body
        : null,
  };
}

export function mockListMessages(_token: string, conversationId: string) {
  const hidden = mockHiddenMessageIds.get(conversationId);
  const items = (mockMessages.get(conversationId) ?? []).filter(
    (m) => !hidden?.has(m.id),
  );
  return {
    items,
    peerLastReadAt: null,
    peerLastDeliveredAt: null,
  };
}

export function mockSendTextMessage(
  _token: string,
  conversationId: string,
  body: string,
  clientId: string,
  replyToMessageId?: string | null,
) {
  const now = new Date().toISOString();
  const list = mockMessages.get(conversationId) ?? [];
  const replyMid = String(replyToMessageId ?? "").trim();
  let replyTo = null;
  if (replyMid) {
    const target = list.find((m) => m.id === replyMid);
    if (target) {
      replyTo = {
        messageId: target.id,
        senderUserId: target.senderUserId,
        type: target.type,
        preview: target.type === "text" ? (target.body ?? null) : null,
      };
    }
  }
  const message: ChatMessage = {
    id: clientId,
    conversationId,
    senderUserId: "me",
    type: "text",
    body,
    moneyTransfer: null,
    replyTo,
    createdAt: now,
    clientId,
  };
  list.push(message);
  mockMessages.set(conversationId, list);
  const conv = mockConversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.lastMessagePreview = body;
    conv.lastMessageType = "text";
    conv.lastMessageAt = now;
    conv.updatedAt = now;
    conv.lastMessageFromSelf = true;
  }
  mockQueuePeerInvite(conversationId, "text");
  return { message };
}

export function mockSendVoiceMessage(
  _token: string,
  conversationId: string,
  key: string,
  durationMs: number,
  clientId: string,
  replyToMessageId?: string | null,
) {
  const now = new Date().toISOString();
  const message: ChatMessage = {
    id: clientId,
    conversationId,
    senderUserId: "me",
    type: "voice",
    body: null,
    moneyTransfer: null,
    voice: { key, durationMs, localUri: null },
    replyTo: mockReplyToFromList(conversationId, replyToMessageId),
    createdAt: now,
    clientId,
  };
  const list = mockMessages.get(conversationId) ?? [];
  list.push(message);
  mockMessages.set(conversationId, list);
  const conv = mockConversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.lastMessagePreview = "VOICE";
    conv.lastMessageType = "voice";
    conv.lastMessageAt = now;
    conv.updatedAt = now;
    conv.lastMessageFromSelf = true;
  }
  mockQueuePeerInvite(conversationId, "voice");
  return { message };
}

export function mockSendImageMessage(
  _token: string,
  conversationId: string,
  key: string,
  width: number,
  height: number,
  clientId: string,
  caption?: string | null,
  replyToMessageId?: string | null,
) {
  const now = new Date().toISOString();
  const text = String(caption ?? "").trim() || null;
  const message: ChatMessage = {
    id: `m-img-${clientId}`,
    conversationId,
    senderUserId: "me",
    type: "image",
    body: text,
    moneyTransfer: null,
    image: { key, width, height, localUri: null },
    replyTo: mockReplyToFromList(conversationId, replyToMessageId),
    createdAt: now,
    clientId,
  };
  const list = mockMessages.get(conversationId) ?? [];
  list.push(message);
  mockMessages.set(conversationId, list);
  const conv = mockConversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.lastMessagePreview = text ?? "📷";
    conv.lastMessageType = "image";
    conv.lastMessageAt = now;
    conv.updatedAt = now;
    conv.lastMessageFromSelf = true;
  }
  mockQueuePeerInvite(conversationId, "image");
  return { message };
}

export function mockSendMoneyMessage(
  _token: string,
  conversationId: string,
  amount: number,
  clientId: string,
  _idempotencyKey: string,
  transactionPin: string,
  replyToMessageId?: string | null,
) {
  if (String(transactionPin).replace(/\D/g, "").length !== 4) {
    throw new ApiError("Code PIN incorrect", 400);
  }
  if (balanceFcfa < amount) {
    throw new ApiError("Solde insuffisant", 409);
  }
  balanceFcfa -= amount;
  const now = new Date().toISOString();
  const transfer: MoneyTransfer = {
    transferId: clientId,
    amountFcfa: amount,
    status: "pending",
    fromUserId: "me",
    toUserId: null,
    toPhone: "",
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    claimedAt: null,
    createdAt: now,
  };
  const message: ChatMessage = {
    id: clientId,
    conversationId,
    senderUserId: "me",
    type: "money",
    body: null,
    moneyTransfer: transfer,
    replyTo: mockReplyToFromList(conversationId, replyToMessageId),
    createdAt: now,
    clientId,
  };
  const list = mockMessages.get(conversationId) ?? [];
  list.push(message);
  mockMessages.set(conversationId, list);
  const conv = mockConversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.lastMessagePreview = `${amount} FCFA`;
    conv.lastMessageType = "money";
    conv.lastMessageAt = now;
    conv.updatedAt = now;
    conv.lastMessageFromSelf = true;
  }
  mockQueuePeerInvite(conversationId, "money");
  return { message, balanceFcfa };
}

export function mockClaimMoneyTransfer(
  _token: string,
  transferId: string,
  action: "claim" | "recall" = "claim",
) {
  for (const list of mockMessages.values()) {
    const msg = list.find((m) => m.moneyTransfer?.transferId === transferId);
    if (msg?.moneyTransfer) {
      const now = new Date().toISOString();
      const uid = mockSessionUserId ?? "me";
      if (action === "recall") {
        msg.moneyTransfer = {
          ...msg.moneyTransfer,
          status: "claimed",
          claimedAt: now,
          claimedByUserId: uid,
          claimedByFirstName: "Moi",
        };
        balanceFcfa += msg.moneyTransfer.amountFcfa;
        return { transfer: msg.moneyTransfer, balanceFcfa };
      }
      msg.moneyTransfer = {
        ...msg.moneyTransfer,
        status: "claimed",
        claimedAt: now,
        claimedByUserId: uid,
        claimedByFirstName: "Moi",
      };
      balanceFcfa += msg.moneyTransfer.amountFcfa;
      return { transfer: msg.moneyTransfer, balanceFcfa };
    }
  }
  throw new ApiError("Transfert introuvable", 404);
}

export function mockThankMoneyTransfer(
  _token: string,
  conversationId: string,
  transferId: string,
) {
  const list = mockMessages.get(conversationId) ?? [];
  const msg = list.find((m) => m.moneyTransfer?.transferId === transferId);
  if (!msg?.moneyTransfer) throw new ApiError("Transfert introuvable", 404);
  const uid = mockSessionUserId ?? "me";
  msg.moneyTransfer = {
    ...msg.moneyTransfer,
    thanksUserId: uid,
    thanksFirstName: "Moi",
  };
  return { ok: true, transfer: msg.moneyTransfer };
}

export function mockMarkConversationTyping(
  _token: string,
  _conversationId: string,
  _on: boolean,
) {
  return { ok: true };
}

export function mockReactToMessage(
  _token: string,
  conversationId: string,
  messageId: string,
  emoji: string | null,
) {
  const uid = mockSessionUserId ?? "me";
  const list = mockMessages.get(conversationId) ?? [];
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx < 0) throw new ApiError("Message introuvable", 404);
  const msg = list[idx];
  const prev = [...(msg.reactions ?? [])];
  const mine = prev.find((r) => r.userId === uid);
  const next =
    !emoji || mine?.emoji === emoji
      ? prev.filter((r) => r.userId !== uid)
      : [...prev.filter((r) => r.userId !== uid), { userId: uid, emoji }];
  list[idx] = { ...msg, reactions: next };
  mockMessages.set(conversationId, list);
  return { ok: true, messageId, reactions: next };
}

export function mockDeleteChatMessage(
  _token: string,
  conversationId: string,
  messageId: string,
  scope: "me" | "everyone",
) {
  const list = mockMessages.get(conversationId) ?? [];
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx < 0) throw new ApiError("Message introuvable", 404);
  const msg = list[idx];
  if (scope === "me") {
    const hidden =
      mockHiddenMessageIds.get(conversationId) ?? new Set<string>();
    hidden.add(messageId);
    mockHiddenMessageIds.set(conversationId, hidden);
    return { ok: true, scope: "me", messageId };
  }
  const updated: ChatMessage = {
    ...msg,
    type: "text",
    body: null,
    voice: null,
    image: null,
    moneyTransfer: null,
    reactions: [],
    replyTo: null,
    deletedForAll: true,
  };
  list[idx] = updated;
  mockMessages.set(conversationId, list);
  return { ok: true, scope: "everyone", messageId, message: updated };
}

export function mockSayHello(): {
  ok: boolean;
  message: string;
  seq: number;
} {
  mockHelloSeq += 1;
  return { ok: true, message: "hello", seq: mockHelloSeq };
}
