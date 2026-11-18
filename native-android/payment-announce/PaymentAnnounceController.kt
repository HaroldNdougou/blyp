package com.haroldndougou.blyp.paymentannounce

import android.content.Context

object PaymentAnnounceController {
  fun handleRemoteData(context: Context, data: Map<String, String>) {
    if (data["type"] != "payment_received") return

    PaymentPushPresenter.showPaymentReceived(context, data)

    if (!PaymentAnnouncePrefs.isEnabled(context)) return

    val txId = data["transactionId"]?.trim().orEmpty()
    if (!PaymentAnnouncePrefs.claimTransaction(context, txId)) return

    val amount = data["amountFcfa"]?.toIntOrNull() ?: return
    if (amount <= 0) return
    if (absorbedByLocal(amount)) return

    val lang = PaymentAnnouncePrefs.getLang(context)
    PaymentAnnounceService.start(context, amount, lang)
  }

  private const val LOCAL_ABSORB_MS = 60_000L
  private val localAnnounced = ArrayDeque<Pair<Int, Long>>()

  /** Annonce reçue à proximité : la confirmation serveur du même montant ne reparle pas. */
  fun announceLocal(
    context: Context,
    amountFcfa: Int,
    lang: String,
    key: String,
    payerName: String? = null,
  ) {
    if (!PaymentAnnouncePrefs.isEnabled(context) || amountFcfa <= 0) return
    if (!PaymentAnnouncePrefs.claimTransaction(context, key)) return
    synchronized(localAnnounced) {
      localAnnounced.addLast(amountFcfa to System.currentTimeMillis() + LOCAL_ABSORB_MS)
      while (localAnnounced.size > 40) localAnnounced.removeFirst()
    }
    PaymentAnnounceService.start(context, amountFcfa, lang, payerName)
  }

  /** Paiement confirmé par le serveur (WS / push). */
  fun announceServer(
    context: Context,
    amountFcfa: Int,
    lang: String,
    txId: String,
    payerName: String? = null,
  ) {
    if (!PaymentAnnouncePrefs.isEnabled(context) || amountFcfa <= 0) return
    if (!PaymentAnnouncePrefs.claimTransaction(context, txId)) return
    if (absorbedByLocal(amountFcfa)) return
    PaymentAnnounceService.start(context, amountFcfa, lang, payerName)
  }

  private fun absorbedByLocal(amountFcfa: Int): Boolean {
    val now = System.currentTimeMillis()
    synchronized(localAnnounced) {
      localAnnounced.removeAll { it.second < now }
      val i = localAnnounced.indexOfFirst { it.first == amountFcfa }
      if (i < 0) return false
      localAnnounced.removeAt(i)
      return true
    }
  }

  fun announceFromJs(
    context: Context,
    amountFcfa: Int,
    lang: String,
    txId: String?,
    payerName: String? = null,
  ) {
    if (!PaymentAnnouncePrefs.isEnabled(context)) return
    if (txId != null && !PaymentAnnouncePrefs.claimTransaction(context, txId)) return
    if (amountFcfa <= 0) return
    PaymentAnnounceService.start(context, amountFcfa, lang, payerName)
  }
}
