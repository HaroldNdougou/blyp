package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.cashiergatt.CashierGattPayerClient
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Pay commerce optimiste natif : dossier local → débit → annonce BLE → POST en fond.
 */
object BlypShellInstantCommercePay {
  private val io = Executors.newSingleThreadExecutor()
  private val bleIo = Executors.newSingleThreadExecutor()

  enum class Outcome {
    /** Destinataire non commerce — continuer le flux pay classique. */
    NotCommerce,
    /** Refus dossier / solde. */
    Denied,
    /** Pay optimiste lancé (annonce + file serveur). */
    Started,
  }

  fun isCommerceRecipient(snap: BlypShellPayRuntime.Snapshot): Boolean {
    val id =
      runCatching { JSONObject(snap.recipientJson).optString("accountId", "") }
        .getOrDefault("")
        .trim()
    return BlypShellPayEligibility.isCommercePayAccountId(id)
  }

  fun optimisticTxId(idempotencyKey: String): String = "pending-pay-${idempotencyKey.trim()}"

  /** Après auth PIN/biométrie. */
  fun runAfterAuth(context: Context, amountFcfa: Int): Outcome {
    val snap = BlypShellPayRuntime.read(context) ?: return Outcome.NotCommerce
    if (!isCommerceRecipient(snap)) return Outcome.NotCommerce
    val recipientId =
      runCatching { JSONObject(snap.recipientJson).optString("accountId", "") }
        .getOrDefault("")
        .trim()
        .uppercase()
    /** Le clavier remet le montant à 0 dès l’ouverture du PIN (vérif RAM effacée) : on la refait ici. */
    if (!BlypShellPayDossierRam.isReadyForPay(amountFcfa, recipientId)) {
      BlypShellPayDossierRam.warmSync(context.applicationContext, amountFcfa)
    }
    if (!BlypShellPayDossierRam.isReadyForPay(amountFcfa, recipientId)) {
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        android.widget.Toast.makeText(
          context.applicationContext,
          BlypShellPayDossierRam.denyMessageRes(),
          android.widget.Toast.LENGTH_LONG,
        ).show()
      }
      return Outcome.Denied
    }
    if (!BlypShellPayDossierStore.isBalanceSufficientForPay(context, amountFcfa)) {
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        android.widget.Toast.makeText(
          context.applicationContext,
          R.string.blyp_shell_pay_insufficient_message,
          android.widget.Toast.LENGTH_LONG,
        ).show()
      }
      return Outcome.Denied
    }
    executeOptimistic(context, amountFcfa, snap)
    return Outcome.Started
  }

  /** Paiement perso via la flèche : l'autre téléphone est prévenu tout de suite. */
  fun deliverArrow(context: Context, amountFcfa: Int, snap: BlypShellPayRuntime.Snapshot) {
    if (isCommerceRecipient(snap)) return
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) return
    val recipient = JSONObject(snap.recipientJson)
    val accountId = recipient.optString("accountId", "").trim().uppercase()
    if (accountId.isEmpty()) return
    val idem = UUID.randomUUID().toString()
    val optimisticId = optimisticTxId(idem)
    val payerName =
      BlypShellSession.profile(context)?.displayName?.trim()?.ifEmpty { null } ?: "—"
    val userPhone = BlypShellSession.phone(context)?.trim().orEmpty()
    val app = context.applicationContext
    bleIo.execute {
      CashierGattPayerClient.deliverWithSessionSync(app, accountId) { session ->
        BlypShellLocalCommerceNotice.build(
          idempotencyKey = idem,
          optimisticTxId = optimisticId,
          amountFcfa = amount,
          recipientAccountId = accountId,
          cashierSession = session,
          payerName = payerName,
          payerPhone = userPhone.ifEmpty { null },
        )?.apply { put("arrow", true) }?.toString()
      }
    }
  }

  /** Paiement notif vers un commerçant : débit + annonce tout de suite, serveur en fond. */
  fun runWithRecipient(context: Context, amountFcfa: Int, recipientJson: String): Outcome {
    val raw = recipientJson.trim()
    if (raw.isEmpty()) return Outcome.NotCommerce
    val accountId =
      runCatching { JSONObject(raw).optString("accountId", "") }.getOrDefault("").trim()
    if (!BlypShellPayEligibility.isCommercePayAccountId(accountId)) return Outcome.NotCommerce
    val pin = BlypShellPayRuntime.readPinOnly(context) ?: run {
      denyToast(context, R.string.blyp_shell_pay_not_configured)
      return Outcome.Denied
    }
    val balance = BlypShellSession.profile(context)?.balanceFcfa ?: 0
    val snap = BlypShellPayRuntime.Snapshot(raw, pin, balance)
    when (val gate = BlypShellPayEligibility.evaluate(context, amountFcfa, snap)) {
      is BlypShellPayEligibility.Result.Deny -> {
        denyToast(context, gate.messageRes)
        return Outcome.Denied
      }
      BlypShellPayEligibility.Result.Ok -> Unit
    }
    BlypShellPayDossierRam.prefetchMerchant(context.applicationContext, accountId.uppercase())
    executeOptimistic(context, amountFcfa, snap)
    return Outcome.Started
  }

  private fun denyToast(context: Context, messageRes: Int) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      android.widget.Toast.makeText(context.applicationContext, messageRes, android.widget.Toast.LENGTH_LONG)
        .show()
    }
  }

  private fun executeOptimistic(
    context: Context,
    amountFcfa: Int,
    snap: BlypShellPayRuntime.Snapshot,
  ) {
    val amount = amountFcfa.coerceAtLeast(0)
    val recipient = JSONObject(snap.recipientJson)
    val recipientName = recipient.optString("name", "").trim()
    val accountId = recipient.optString("accountId", "").trim().uppercase()
    val phone =
      recipient.optString("phoneDigits", "").replace(Regex("\\D"), "").takeLast(9)
    val userPhone = BlypShellSession.phone(context)?.trim().orEmpty()
    val balanceBefore = BlypShellPayEligibility.effectiveBalanceFcfa(context, snap)
    val idem = UUID.randomUUID().toString()
    val optimisticId = optimisticTxId(idem)
    val balanceAfter = balanceBefore - amount

    BlypShellPayRuntime.updateBalance(context, balanceAfter)
    BlypShellUiRefresh.notifyWalletChanged()

    if (userPhone.isNotEmpty()) {
      val now = java.time.Instant.now().toString()
      BlypTransactionStore.insertSentTransaction(
        context,
        userPhone,
        optimisticId,
        amount,
        recipientName,
        phone.ifEmpty { null },
        now,
        idem,
      )
    }

    BlypShellOfflinePayQueue.enqueueCommerceInstant(
      context,
      amount,
      idem,
      snap.recipientJson,
      balanceBeforeFcfa = balanceBefore,
      optimisticTxId = optimisticId,
    )

    val payerName =
      BlypShellSession.profile(context)?.displayName?.trim()?.ifEmpty { null } ?: "—"
    val app = context.applicationContext
    BlypShellPayDossierRam.takeCachedCashierSession()?.let {
      BlypShellOfflinePayQueue.patchCashierSession(app, idem, it)
    }
    /** Annonce caisse (Bluetooth) et envoi serveur partent en même temps. */
    bleIo.execute {
      val t0 = android.os.SystemClock.elapsedRealtime()
      val session =
        CashierGattPayerClient.deliverWithSessionSync(app, accountId) { session ->
          BlypShellLocalCommerceNotice.build(
            idempotencyKey = idem,
            optimisticTxId = optimisticId,
            amountFcfa = amount,
            recipientAccountId = accountId,
            cashierSession = session,
            payerName = payerName,
            payerPhone = userPhone.ifEmpty { null },
          )?.toString()
        }
      BlypShellDeviceKey.perf("cashier_ble_deliver", t0, " ok=${session != null}")
    }
    io.execute {
      BlypShellOfflinePayQueue.flush(app)
      BlypShellPayDossierRam.invalidate()
    }
  }
}
