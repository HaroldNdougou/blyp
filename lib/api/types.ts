/** Étape onboarding côté serveur (`null` = profil complet). */
export type OnboardingStep = "pin" | "profile";

export type CommerceCategory = "taxi" | "shop" | "other";

export type ApiCommerce = {
  id: string;
  accountId: string;
  name: string;
  category: CommerceCategory | string;
  phoneDigits: string | null;
  balanceFcfa: number;
  createdAt?: string | null;
};

export type ApiActiveContext =
  | { type: "personal" }
  | {
      type: "commerce";
      commerceId: string;
      name: string;
      accountId: string;
      category?: string;
    };

export type ApiUser = {
  /** ID compte public actif (BLYP-U-… perso ou BLYP-C-… commerce). */
  id: string | null;
  /** ID perso stable. */
  personalAccountId?: string | null;
  phone: string;
  balanceFcfa: number;
  personalBalanceFcfa?: number;
  needsOnboarding: boolean;
  onboardingStep: OnboardingStep | null;
  firstName: string | null;
  lastName: string | null;
  personalFirstName?: string | null;
  personalLastName?: string | null;
  isMerchant?: boolean;
  activeContext?: ApiActiveContext;
  commerces?: ApiCommerce[];
};

export type TransactionItem = {
  id: string;
  /** Référence publique (ex. BLYP-P260802-7KQ9XM2A). */
  reference: string;
  type: "sent" | "received";
  amountFcfa: number;
  counterpartyName: string;
  counterpartyPhone: string | null;
  createdAt: string;
};

/** Réponse POST `/wallet/deposit` */
export type WalletDepositResponse =
  | {
      status: "completed";
      balanceFcfa: number;
      transactionId: string;
      reference?: string | null;
      depositIntentId: string;
    }
  | {
      status: "pending_provider";
      depositIntentId: string;
      /** UUID envoyé à PawaPay (debug / support). */
      pawapayDepositId?: string;
      message?: string;
      providerRef?: string;
    };

/** Réponse GET `/wallet/deposits/:id` */
export type WalletDepositStatusResponse =
  | {
      status: "completed";
      depositIntentId: string;
      amountFcfa: number;
      balanceFcfa: number;
      transactionId: string | null;
      reference?: string | null;
    }
  | {
      status: "pending_provider";
      depositIntentId: string;
      amountFcfa: number;
    }
  | {
      status: "failed";
      depositIntentId: string;
      amountFcfa: number;
      failureReason: string | null;
    };

export type MoneyTransferStatus =
  | "pending"
  | "claimed"
  | "expired"
  | "cancelled";

export type MoneyTransfer = {
  transferId: string;
  amountFcfa: number;
  status: MoneyTransferStatus;
  fromUserId: string;
  toUserId: string | null;
  toPhone: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  type: "text" | "money";
  body: string | null;
  moneyTransfer: MoneyTransfer | null;
  createdAt: string;
  clientId: string | null;
};

export type Conversation = {
  id: string;
  type: "direct" | string;
  peerName: string;
  peerPhone: string | null;
  peerUserId: string | null;
  lastMessagePreview: string;
  lastMessageType: "text" | "money" | null;
  lastMessageAt: string | null;
  updatedAt: string;
};
