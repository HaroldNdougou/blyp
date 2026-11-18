package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors

/** Annonce caisse reçue en Bluetooth (paiement en ligne, envoyé en parallèle au serveur). */
object BlypShellCommerceReceiptHandler {
  private val io = Executors.newSingleThreadExecutor()
  private val voicedTx = LinkedHashSet<String>()

  fun handleReceiptJson(context: Context, receiptJson: String) {
    io.execute { handleReceiptJsonSync(context.applicationContext, receiptJson) }
  }

  private fun dbg(msg: String) {
    if (com.haroldndougou.blyp.BuildConfig.DEBUG) android.util.Log.d("BlypCashierRx", msg)
  }

  private fun handleReceiptJsonSync(context: Context, receiptJson: String) {
    dbg("rx ${receiptJson.length}b")
    val commerceId = BlypShellCommerceSession.activeCommerceId(context) ?: run {
      dbg("no active commerce")
      return
    }
    val merchantAccountId = BlypShellSession.accountId(context)?.trim()?.uppercase().orEmpty()
    if (merchantAccountId.isEmpty()) return

    val receipt =
      try {
        JSONObject(receiptJson)
      } catch (_: Exception) {
        return
      }

    if (!receipt.optBoolean("localAccept", false)) return
    handleLocalPayNoticeSync(context, commerceId, merchantAccountId, receipt)
  }

  private fun handleLocalPayNoticeSync(
    context: Context,
    commerceId: String,
    merchantAccountId: String,
    notice: JSONObject,
  ) {
    if (notice.optInt("v", 0) != 2) return
    val expiresAt = notice.optLong("expiresAt", 0L)
    if (expiresAt > 0 && System.currentTimeMillis() > expiresAt) return

    val recipient = notice.optString("recipientAccountId", "").trim().uppercase()
    if (recipient != merchantAccountId) return

    val receiptCommerce =
      if (notice.isNull("commerceId")) "" else notice.optString("commerceId", "").trim()
    if (receiptCommerce.isNotEmpty() && receiptCommerce != commerceId) return

    val session = notice.optInt("cashierSession", -1)
    if (session != BlypShellClosedCashier.merchantSessionId()) {
      dbg("local notice session mismatch got=$session want=${BlypShellClosedCashier.merchantSessionId()}")
      return
    }

    val amount = notice.optInt("amountFcfa", 0)
    if (amount <= 0) return

    val voiceKey =
      notice.optString("idempotencyKey", "").trim().ifEmpty {
        notice.optString("transactionId", "").trim()
      }
    if (voiceKey.isEmpty()) return

    val payerName = notice.optString("reference", "").trim().ifEmpty { "—" }
    val payerPhone =
      if (notice.isNull("payerPhone")) null
      else notice.optString("payerPhone", "").trim().ifEmpty { null }
    val txId = notice.optString("transactionId", voiceKey).trim()

    synchronized(voicedTx) {
      if (voicedTx.contains(voiceKey)) return
      voicedTx.add(voiceKey)
      if (voicedTx.size > 80) voicedTx.remove(voicedTx.first())
      val lang = if (Locale.getDefault().language == "fr") "fr" else "en"
      com.haroldndougou.blyp.paymentannounce.PaymentAnnounceController.announceLocal(
        context,
        amount,
        lang,
        voiceKey,
        payerName,
      )
    }

    BlypShellWalletIngest.applyLocalCommerceCredit(
      context,
      commerceId,
      txId,
      amount,
      payerName,
      payerPhone,
    )
    BlypShellIncomingFlash.notifyCommerceReceived(amount, txId)
  }
}
