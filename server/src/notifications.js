/**
 * Modèles de notifications : textes exclusivement serveur (sécurité, cohérence).
 * Le client ne peut pas injecter de corps arbitraire en base.
 */

export const NOTIFICATION_KIND = {
  ONBOARDING_WELCOME: "onboarding_welcome",
  WALLET_DEPOSIT: "wallet_deposit",
  PAYMENT_SENT: "payment_sent",
};

export function toastOnboardingWelcome(firstName) {
  const name = String(firstName ?? "").trim().slice(0, 80);
  return {
    kind: NOTIFICATION_KIND.ONBOARDING_WELCOME,
    title: "Bienvenue sur Blyp",
    body: name
      ? `${name}, votre compte est prêt.`
      : "Votre inscription est terminée.",
    emoji: "🎉",
  };
}

export function toastWalletDeposit(amountFcfa) {
  const n = Number(amountFcfa);
  const label = Number.isFinite(n)
    ? `+${Math.round(n).toLocaleString("fr-FR")} FCFA`
    : "+ crédit";
  return {
    kind: NOTIFICATION_KIND.WALLET_DEPOSIT,
    title: "Solde crédité",
    body: `${label} sur votre compte.`,
    emoji: "💰",
  };
}

export function toastPaymentSent(amountFcfa, recipientName) {
  const n = Number(amountFcfa);
  const amt = Number.isFinite(n)
    ? `${Math.round(n).toLocaleString("fr-FR")} FCFA`
    : "";
  const who = String(recipientName ?? "")
    .trim()
    .slice(0, 80) || "Bénéficiaire";
  return {
    kind: NOTIFICATION_KIND.PAYMENT_SENT,
    title: "Paiement envoyé",
    body: amt ? `${amt} envoyés à ${who}` : `Envoyé à ${who}`,
    emoji: "✅",
  };
}
