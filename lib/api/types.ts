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
