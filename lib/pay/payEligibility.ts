import type { ApiUser } from "@/lib/api/types";
import { formatFcfa } from "@/lib/formatFcfa";
import { maxTxAmountFcfaForUser } from "@/lib/kyc/limits";
import i18n from "@/lib/i18n";

export type PayEligibilityDenyReason =
  | "NO_TOKEN"
  | "NO_RECIPIENT"
  | "AMOUNT"
  | "ONBOARDING"
  | "COMMERCE_CONTEXT"
  | "INSUFFICIENT"
  | "KYC_LIMIT";

export type PayEligibilityInput = {
  token: string | null | undefined;
  user: ApiUser | null | undefined;
  amountFcfa: number;
  recipientAccountId: string | null | undefined;
};

export function isCommercePayAccountId(accountId: string | null | undefined): boolean {
  const id = String(accountId ?? "").trim().toUpperCase();
  return id.startsWith("BLYP-C-");
}

export function evaluatePayEligibility(
  input: PayEligibilityInput,
):
  | { ok: true }
  | { ok: false; reason: PayEligibilityDenyReason; message: string } {
  const amount = Math.floor(Number(input.amountFcfa));
  if (!input.token?.trim()) {
    return { ok: false, reason: "NO_TOKEN", message: i18n.t("common.genericError") };
  }
  const accountId = String(input.recipientAccountId ?? "").trim();
  if (!accountId) {
    return { ok: false, reason: "NO_RECIPIENT", message: i18n.t("ble.noTaxiMessage") };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "AMOUNT", message: i18n.t("common.genericError") };
  }
  const user = input.user;
  if (!user || user.needsOnboarding) {
    return {
      ok: false,
      reason: "ONBOARDING",
      message: i18n.t("pay.onboardingRequiredMessage"),
    };
  }
  if (user.activeContext?.type === "commerce") {
    return {
      ok: false,
      reason: "COMMERCE_CONTEXT",
      message: i18n.t("profile.payAsPersonalMessage"),
    };
  }
  const balance = Math.floor(Number(user.balanceFcfa) || 0);
  if (amount > balance) {
    return {
      ok: false,
      reason: "INSUFFICIENT",
      message: i18n.t("pay.insufficientBalance"),
    };
  }
  const maxTx = maxTxAmountFcfaForUser(user);
  if (amount > maxTx) {
    return {
      ok: false,
      reason: "KYC_LIMIT",
      message: i18n.t("profile.limitCurrent", {
        amount: formatFcfa(maxTx),
      }),
    };
  }
  return { ok: true };
}
