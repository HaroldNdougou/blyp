import type { ApiUser } from "@/lib/api/types";
import type { KycStatus } from "@/lib/kyc/types";

/** Plafond par paiement — compte téléphone seul (niveau 0). */
export const KYC_TX_MAX_UNVERIFIED_FCFA = 100_000;

/** Plafond par paiement — identité vérifiée (niveau 1). */
export const KYC_TX_MAX_VERIFIED_FCFA = 999_999;

export function isKycApproved(user: ApiUser | null | undefined): boolean {
  return user?.kycStatus === "approved";
}

export function maxTxAmountFcfaForUser(
  user: ApiUser | null | undefined,
): number {
  if (isKycApproved(user)) return KYC_TX_MAX_VERIFIED_FCFA;
  return KYC_TX_MAX_UNVERIFIED_FCFA;
}

export function kycStatusForUser(user: ApiUser | null | undefined): KycStatus {
  const s = user?.kycStatus;
  if (
    s === "pending" ||
    s === "approved" ||
    s === "rejected" ||
    s === "none"
  ) {
    return s;
  }
  return "none";
}
