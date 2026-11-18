package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.cashiergatt.CashierGattPayerClient
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Dossier vérifié en amont (RAM + magasin signé). Solde comparé seulement à la validation.
 */
object BlypShellPayDossierRam {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var debounce: Runnable? = null

  @Volatile private var dossierOk = false
  @Volatile private var checkedAmountFcfa = 0
  @Volatile private var checkedRecipientId = ""
  @Volatile private var denyMessageRes: Int = R.string.blyp_shell_pay_not_configured
  @Volatile private var commerceInstant = false
  @Volatile private var cachedCashierSession: Int? = null

  fun invalidate() {
    dossierOk = false
    checkedAmountFcfa = 0
    checkedRecipientId = ""
    cachedCashierSession = null
    commerceInstant = false
  }

  /** Dossier + montant OK (hors solde — solde au PIN). */
  fun isReadyForPay(amountFcfa: Int, recipientAccountId: String): Boolean {
    if (!dossierOk) return false
    val id = recipientAccountId.trim().uppercase()
    if (id.isEmpty()) return false
    return checkedAmountFcfa == amountFcfa.coerceAtLeast(0) && checkedRecipientId == id
  }

  fun denyMessageRes(): Int = denyMessageRes

  fun takeCachedCashierSession(): Int? = cachedCashierSession

  fun scheduleWarm(context: Context, amountFcfa: Int) {
    val app = context.applicationContext
    debounce?.let { main.removeCallbacks(it) }
    val run =
      Runnable {
        io.execute { warmSync(app, amountFcfa) }
      }
    debounce = run
    main.postDelayed(run, 50L)
  }

  fun warmSync(context: Context, amountFcfa: Int) {
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) {
      invalidate()
      return
    }
    var verified = BlypShellPayDossierStore.readVerified(context)
    /** Dossier absent ou refus figé (écrit avant PIN / session / destinataire) : on recalcule. */
    if (verified == null || !verified.payAllowed) {
      BlypShellPayDossierStore.refreshFromSources(context)
      verified = BlypShellPayDossierStore.readVerified(context)
    }
    val snap = BlypShellPayRuntime.read(context)
    if (verified == null || !verified.payAllowed || snap == null) {
      invalidate()
      denyMessageRes = denyReason(context, amount, snap, verified)
      return
    }
    val recipientId =
      runCatching { JSONObject(snap.recipientJson).optString("accountId", "") }
        .getOrDefault("")
        .trim()
        .uppercase()
    if (recipientId.isNotBlank() && recipientId != verified.recipientAccountId) {
      BlypShellPayDossierStore.refreshFromSources(context)
      val fresh = BlypShellPayDossierStore.readVerified(context)
      if (fresh == null || !fresh.payAllowed) {
        invalidate()
        denyMessageRes =
          if (fresh?.payBlocked == true) R.string.blyp_shell_pay_blocked
          else R.string.blyp_shell_pay_not_configured
        return
      }
      verified = fresh
    }
    if (recipientId.isBlank() || recipientId != verified.recipientAccountId) {
      invalidate()
      denyMessageRes = R.string.blyp_shell_pay_not_configured
      return
    }
    when (val gate = BlypShellPayEligibility.evaluateExceptBalance(context, amount, snap)) {
      is BlypShellPayEligibility.Result.Deny -> {
        dossierOk = false
        denyMessageRes = gate.messageRes
        checkedAmountFcfa = amount
        checkedRecipientId = recipientId
        commerceInstant = false
        cachedCashierSession = null
      }
      BlypShellPayEligibility.Result.Ok -> {
        if (amount > verified.maxTxFcfa) {
          dossierOk = false
          denyMessageRes = R.string.blyp_shell_pay_kyc_limit
          checkedAmountFcfa = amount
          checkedRecipientId = recipientId
          commerceInstant = false
          cachedCashierSession = null
          return
        }
        dossierOk = true
        denyMessageRes = R.string.blyp_shell_pay_not_configured
        checkedAmountFcfa = amount
        checkedRecipientId = recipientId
        commerceInstant = BlypShellPayEligibility.isCommercePayAccountId(recipientId)
        cachedCashierSession =
          if (commerceInstant) CashierGattPayerClient.cachedSession(recipientId) else null
        if (commerceInstant) {
          prefetchMerchant(context, recipientId)
        }
      }
    }
  }

  /** Cause réelle du refus (pas un « configurez Pay » générique). */
  private fun denyReason(
    context: Context,
    amount: Int,
    snap: BlypShellPayRuntime.Snapshot?,
    verified: BlypShellPayDossierStore.Verified?,
  ): Int {
    val res =
      when {
        verified?.payBlocked == true -> R.string.blyp_shell_pay_blocked
        snap == null -> R.string.blyp_shell_pay_not_configured
        else ->
          (BlypShellPayEligibility.evaluateExceptBalance(context, amount, snap)
            as? BlypShellPayEligibility.Result.Deny)?.messageRes
            ?: R.string.blyp_shell_pay_not_configured
      }
    if (com.haroldndougou.blyp.BuildConfig.DEBUG) {
      android.util.Log.w(
        "BlypPayDossier",
        "refus: snap=${snap != null} verified=${verified != null} " +
          "allowed=${verified?.payAllowed} runtime=${BlypShellRuntime.read(context) != null} " +
          "phone=${!BlypShellSession.phone(context).isNullOrBlank()} " +
          "onboarding=${BlypShellSession.needsOnboarding(context)} " +
          "commerceMode=${BlypShellSession.isCommerceMode(context)} " +
          "msg=${context.resources.getResourceEntryName(res)}",
      )
    }
    return res
  }

  private val bleIo = Executors.newSingleThreadExecutor()
  @Volatile private var prefetchInFlight = ""
  @Volatile private var lastMissRecipient = ""
  @Volatile private var lastMissAtMs = 0L
  private const val MISS_RETRY_MS = 10_000L

  /** Ouvre (ou garde) la liaison caisse, hors du fil de vérification dossier. */
  fun prefetchMerchant(context: Context, recipientId: String) {
    if (prefetchInFlight == recipientId) return
    if (lastMissRecipient == recipientId &&
      System.currentTimeMillis() - lastMissAtMs < MISS_RETRY_MS
    ) {
      return
    }
    prefetchInFlight = recipientId
    bleIo.execute {
      try {
        val session = CashierGattPayerClient.prefetchMerchantSync(context, recipientId)
        if (session == null) {
          lastMissRecipient = recipientId
          lastMissAtMs = System.currentTimeMillis()
        } else if (checkedRecipientId == recipientId) {
          cachedCashierSession = session
        }
      } finally {
        prefetchInFlight = ""
      }
    }
  }
}
