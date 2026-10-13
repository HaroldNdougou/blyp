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
  /** Photo Blyp sur le CDN (null si jamais définie). */
  avatarUrl?: string | null;
};

export type TransactionItem = {
  id: string;
  /** Référence publique (ex. BLYP-P260802-7KQ9XM2A). */
  reference: string;
  type: "sent" | "received";
  /** Type ledger serveur (MONEY_SEND, PAYMENT, MONEY_RECALL…) — absent sur vieux cache. */
  kind?: string | null;
  amountFcfa: number;
  counterpartyName: string;
  counterpartyPhone: string | null;
  createdAt: string;
};

export type PocketKind = "savings" | "custom";

export type Pocket = {
  id: string;
  name: string;
  kind: PocketKind;
  balanceFcfa: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PocketTransaction = {
  id: string;
  pocketId: string;
  /** in = disponible → poche ; out = poche → disponible */
  direction: "in" | "out";
  amountFcfa: number;
  createdAt: string;
};

export type PocketMoveResponse = {
  pocket: Pocket | null;
  balanceFcfa: number;
  transaction: PocketTransaction | null;
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
  conversationId?: string | null;
  amountFcfa: number;
  status: MoneyTransferStatus;
  fromUserId: string;
  toUserId: string | null;
  toPhone: string;
  expiresAt: string;
  claimedAt: string | null;
  claimedByUserId?: string | null;
  claimedByFirstName?: string | null;
  thanksUserId?: string | null;
  thanksFirstName?: string | null;
  createdAt: string;
};

export type VoiceClip = {
  key: string;
  durationMs: number;
  localUri?: string | null;
};

export type ImageAttachment = {
  key: string;
  width?: number;
  height?: number;
  localUri?: string | null;
  contentType?: string;
};

export type MessageReaction = {
  emoji: string;
  userId: string;
};

/** Citation d’un message (réponse) — snapshot pour l’affichage si l’original change. */
export type MessageReplyTo = {
  messageId: string;
  senderUserId: string;
  type: "text" | "money" | "voice" | "image";
  preview: string | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  type: "text" | "money" | "voice" | "image";
  body: string | null;
  moneyTransfer: MoneyTransfer | null;
  voice?: VoiceClip | null;
  image?: ImageAttachment | null;
  reactions?: MessageReaction[];
  replyTo?: MessageReplyTo | null;
  createdAt: string;
  clientId: string | null;
  /** Bulle « message supprimé » (pour tout le monde). */
  deletedForAll?: boolean;
};

export type BlypPhoneLookupItem = {
  phone: string;
  onBlyp: boolean;
};

export type Conversation = {
  id: string;
  type: "direct" | string;
  peerName: string;
  peerPhone: string | null;
  peerUserId: string | null;
  lastMessagePreview: string;
  lastMessageType: "text" | "money" | "voice" | "image" | "reaction" | null;
  lastMessageAt: string | null;
  /** Dernier message de la conversation envoyé par moi (liste + coches). */
  lastMessageFromSelf?: boolean;
  updatedAt: string;
  /** URL absolue (démo ou CDN) — prioritaire sur le carnet pour l’avatar. */
  peerAvatarUrl?: string | null;
};

export type ConversationReceiptKind = "read" | "delivered";

export type ConversationReceipts = {
  peerLastReadAt: string | null;
  peerLastDeliveredAt: string | null;
};
