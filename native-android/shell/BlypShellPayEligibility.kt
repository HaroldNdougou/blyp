package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R

/** Vérif solde / onboarding / contexte — aligné `lib/pay/payEligibility.ts`. */
object BlypShellPayEligibility {
  private const val KYC_TX_MAX_UNVERIFIED = 100_000
  private const val KYC_TX_MAX_VERIFIED = 999_999

  sealed class Result {
    data object Ok : Result()
    data class Deny(val messageRes: Int) : Result()
  }

  fun isCommercePayAccountId(accountId: String?): Boolean {
    return accountId?.trim()?.uppercase()?.startsWith("BLYP-C-") == true
  }

  fun maxTxFcfa(context: Context): Int {
    val kyc =
      BlypShellSession.profile(context)?.kycStatus?.trim()?.lowercase() ?: "none"
    return if (kyc == "approved") KYC_TX_MAX_VERIFIED else KYC_TX_MAX_UNVERIFIED
  }

  fun effectiveBalanceFcfa(context: Context, paySnap: BlypShellPayRuntime.Snapshot): Int {
    val sessionBal = BlypShellSession.profile(context)?.balanceFcfa
    return if (sessionBal != null) {
      minOf(sessionBal, paySnap.balanceFcfa)
    } else {
      paySnap.balanceFcfa
    }
  }

  fun evaluate(
    context: Context,
    amountFcfa: Int,
    paySnap: BlypShellPayRuntime.Snapshot,
  ): Result = evaluateExceptBalance(context, amountFcfa, paySnap).let { r ->
    if (r !is Result.Ok) return r
    val balance = effectiveBalanceFcfa(context, paySnap)
    if (amountFcfa.coerceAtLeast(0) > balance) {
      return Result.Deny(R.string.blyp_shell_pay_insufficient_message)
    }
    Result.Ok
  }

  /** Dossier + plafond montant — sans comparer le solde (fait au clic payer). */
  fun evaluateExceptBalance(
    context: Context,
    amountFcfa: Int,
    paySnap: BlypShellPayRuntime.Snapshot,
  ): Result {
    val amount = amountFcfa.coerceAtLeast(0)
    if (BlypShellRuntime.read(context) == null) {
      return Result.Deny(R.string.blyp_shell_pay_not_configured)
    }
    val recipient =
      runCatching { org.json.JSONObject(paySnap.recipientJson).optString("accountId", "") }
        .getOrDefault("")
        .trim()
    if (recipient.isBlank()) {
      return Result.Deny(R.string.blyp_shell_pay_not_configured)
    }
    if (amount <= 0) {
      return Result.Deny(R.string.blyp_shell_pay_not_configured)
    }
    if (BlypShellSession.isPayBlocked(context)) {
      return Result.Deny(R.string.blyp_shell_pay_blocked)
    }
    if (BlypShellSession.needsOnboarding(context)) {
      return Result.Deny(R.string.blyp_shell_pay_onboarding_required)
    }
    if (BlypShellSession.isCommerceMode(context)) {
      return Result.Deny(R.string.blyp_shell_pay_personal_context_required)
    }
    if (amount > maxTxFcfa(context)) {
      return Result.Deny(R.string.blyp_shell_pay_kyc_limit)
    }
    return Result.Ok
  }
}
