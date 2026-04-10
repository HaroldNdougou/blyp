/** Étape onboarding côté serveur (`null` = profil complet). */
export type OnboardingStep = "pin" | "profile";

export type ApiUser = {
  phone: string;
  balanceFcfa: number;
  needsOnboarding: boolean;
  onboardingStep: OnboardingStep | null;
  firstName: string | null;
  lastName: string | null;
};

export type TransactionItem = {
  id: string;
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
