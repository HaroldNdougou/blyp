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

/** Toast renvoyé par l’API après un événement (texte défini côté serveur). */
export type ApiToastPayload = {
  id: string;
  kind: string;
  title: string;
  body: string;
  emoji: string | null;
};

export type ApiNotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  emoji: string | null;
  read: boolean;
  createdAt: string;
};
