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

    val lang = PaymentAnnouncePrefs.getLang(context)
    PaymentAnnounceService.start(context, amount, lang)
  }

  fun announceFromJs(
    context: Context,
    amountFcfa: Int,
    lang: String,
    txId: String?,
  ) {
    if (!PaymentAnnouncePrefs.isEnabled(context)) return
    if (txId != null && !PaymentAnnouncePrefs.claimTransaction(context, txId)) return
    if (amountFcfa <= 0) return
    PaymentAnnounceService.start(context, amountFcfa, lang)
  }
}
