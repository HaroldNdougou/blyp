/** Étape onboarding côté serveur (`null` = profil complet). */
export type OnboardingStep = "pin" | "profile";

export type KycStatus = "none" | "pending" | "approved" | "rejected";

export type KycDocType = "national_id" | "passport";

export type KycDocumentSide = "front" | "back" | "selfie";

export type CommerceCategory = "taxi" | "shop" | "other" | "soa_car";

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
  kycStatus?: KycStatus;
  /** 0 = téléphone seul, 1 = identité vérifiée. */
  kycLevel?: number;
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

export type VaultDocument = {
  id: string;
  accountId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
};

export type VaultListResponse = {
  items: VaultDocument[];
  usedBytes: number;
  maxBytes: number;
  accountId: string;
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
  /** Le payeur exige un reçu Blyp pour récupérer (escrow). */
  receiptRequired?: boolean;
};

export type VoiceClip = {
  key: string;
  durationMs: number;
  localUri?: string | null;
};

export type ImageAttachment = {
  key: string;
  /** Miniature S3 (quelques Ko) — affichée avant la HD. */
  thumbKey?: string | null;
  width?: number;
  height?: number;
  localUri?: string | null;
  contentType?: string;
  /** Placeholder expo-image (généré à l’envoi côté client). */
  blurhash?: string | null;
};

export type DocumentAttachment = {
  key: string;
  fileName: string;
  sizeBytes: number;
  contentType?: string;
  localUri?: string | null;
  /** Vignette JPEG sur S3 (aperçu bulle / liste). */
  thumbKey?: string | null;
  /** Nombre de pages PDF (expéditeur → serveur). */
  pageCount?: number;
};

export type MessageReaction = {
  emoji: string;
  userId: string;
};

/** Citation d’un message (réponse) — snapshot pour l’affichage si l’original change. */
export type MessageReplyTo = {
  messageId: string;
  senderUserId: string;
  type: "text" | "money" | "voice" | "image" | "document";
  preview: string | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  type: "text" | "money" | "voice" | "image" | "document";
  body: string | null;
  moneyTransfer: MoneyTransfer | null;
  voice?: VoiceClip | null;
  image?: ImageAttachment | null;
  document?: DocumentAttachment | null;
  reactions?: MessageReaction[];
  replyTo?: MessageReplyTo | null;
  createdAt: string;
  clientId: string | null;
  /** Bulle « message supprimé » (pour tout le monde). */
  deletedForAll?: boolean;
  /** Message transféré (style WhatsApp). */
  forwarded?: boolean;
  /** Paiement via fruit (picker emoji Argent). */
  moneyFruitEmoji?: string | null;
  /** Idempotence POST 💰 — renvoi hors ligne (pas un secret). */
  moneySendIdempotencyKey?: string | null;
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
  lastMessageType:
    | "text"
    | "money"
    | "voice"
    | "image"
    | "document"
    | "reaction"
    | null;
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

/** Statut WhatsApp-like (24 h). */
export type StatusPostKind = "image" | "text";

/** Indices palette compose (`STATUS_TEXT_*` dans `lib/status/textStatusPalette.ts`). */
export type StatusTextPostStyle = {
  bgIndex: number;
  fontIndex: number;
};

export type StatusPost = {
  id: string;
  userId: string;
  kind: StatusPostKind;
  /** Image CDN / locale ; null si texte seul. */
  mediaUrl: string | null;
  text: string | null;
  /** Présent pour `kind === "text"` (fond + typo à la publication). */
  textStyle?: StatusTextPostStyle | null;
  createdAt: string;
  expiresAt: string;
};

export type StatusFeedItem = {
  userId: string;
  displayName: string;
  peerPhone: string | null;
  avatarUrl: string | null;
  posts: StatusPost[];
  /** Au moins un post non vu par moi. */
  hasUnseen: boolean;
};

export type StatusFeedResponse = {
  items: StatusFeedItem[];
  myUserId: string;
};

export type PublishStatusBody = {
  kind: StatusPostKind;
  /** Mock / dev local. */
  mediaUrl?: string | null;
  /** Prod : clé S3 après presign + PUT. */
  mediaKey?: string | null;
  text?: string | null;
  textStyle?: StatusTextPostStyle | null;
};
