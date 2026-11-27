package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.haroldndougou.blyp.cashiergatt.CashierGattController
import com.haroldndougou.blyp.shell.BlypShellBluetooth

object PaymentAnnounceController {
  private const val LOCAL_ABSORB_MS = 60_000L
  private const val SPOKEN_MS = 8_000L
  /** Le Bluetooth arrive souvent juste avant la notification : on la laisse passer seulement s'il ne vient pas. */
  private const val BLE_WAIT_MS = 2_200L

  private val main = Handler(Looper.getMainLooper())
  private val localAnnounced = ArrayDeque<Pair<Int, Long>>()
  private val spoken = ArrayDeque<Pair<Int, Long>>()
  private val pendingServer = ArrayDeque<PendingServer>()
  private val pendingNotif = ArrayDeque<PendingServer>()

  private class PendingServer(
    val amount: Int,
    val run: Runnable,
  )

  fun handleRemoteData(context: Context, data: Map<String, String>) {
    if (data["type"] != "payment_received") return

    schedulePaymentNotification(context, data)

    val txId = data["transactionId"]?.trim().orEmpty()
    val amount = data["amountFcfa"]?.toIntOrNull() ?: return
    scheduleServer(context, amount, PaymentAnnouncePrefs.getLang(context), txId, null)
  }

  /** Paiement Bluetooth : la notif part du téléphone, tout de suite, et vibre. */
  fun onBlePayment(context: Context, amountFcfa: Int, payerName: String?, txId: String) {
    if (amountFcfa <= 0) return
    PaymentPushPresenter.rememberBle(amountFcfa)
    val cancelled = cancelPendingNotif(amountFcfa)
    repeat(cancelled) { PaymentPushPresenter.takeBle(amountFcfa) }
    PaymentPushPresenter.showBle(context, amountFcfa, payerName, txId)
  }

  private fun schedulePaymentNotification(context: Context, data: Map<String, String>) {
    val amount = data["amountFcfa"]?.toIntOrNull() ?: return
    if (amount <= 0) return
    val commerce = data["contextType"] == "commerce"
    val app = context.applicationContext
    if (!commerce || !canHearBle(app)) {
      if (commerce && PaymentPushPresenter.takeBle(amount)) return
      PaymentPushPresenter.showPaymentReceived(app, data)
      return
    }
    if (PaymentPushPresenter.takeBle(amount)) return
    val pending =
      PendingServer(amount, Runnable {
        dropPendingNotif(amount)
        if (PaymentPushPresenter.takeBle(amount)) return@Runnable
        PaymentPushPresenter.showPaymentReceived(app, data)
      })
    synchronized(pendingNotif) { pendingNotif.addLast(pending) }
    main.postDelayed(pending.run, BLE_WAIT_MS)
  }

  private fun cancelPendingNotif(amountFcfa: Int): Int {
    val runs = ArrayList<Runnable>()
    synchronized(pendingNotif) {
      val it = pendingNotif.iterator()
      while (it.hasNext()) {
        val p = it.next()
        if (p.amount != amountFcfa) continue
        runs.add(p.run)
        it.remove()
      }
    }
    for (run in runs) main.removeCallbacks(run)
    return runs.size
  }

  private fun dropPendingNotif(amountFcfa: Int) {
    synchronized(pendingNotif) {
      val it = pendingNotif.iterator()
      while (it.hasNext()) {
        if (it.next().amount == amountFcfa) {
          it.remove()
          return
        }
      }
    }
  }

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
    rememberLocal(amountFcfa)
    cancelPendingServer(amountFcfa)
    if (wasSpoken(amountFcfa)) return
    speak(context, amountFcfa, lang, payerName)
  }

  /** Paiement confirmé par le serveur (WS / push). */
  fun announceServer(
    context: Context,
    amountFcfa: Int,
    lang: String,
    txId: String,
    payerName: String? = null,
  ) {
    scheduleServer(context, amountFcfa, lang, txId, payerName)
  }

  fun announceFromJs(
    context: Context,
    amountFcfa: Int,
    lang: String,
    txId: String?,
    payerName: String? = null,
  ) {
    scheduleServer(context, amountFcfa, lang, txId?.trim().orEmpty(), payerName)
  }

  private fun scheduleServer(
    context: Context,
    amountFcfa: Int,
    lang: String,
    txId: String,
    payerName: String?,
  ) {
    if (!PaymentAnnouncePrefs.isEnabled(context) || amountFcfa <= 0) return
    if (txId.isNotEmpty() && !PaymentAnnouncePrefs.claimTransaction(context, txId)) return
    if (absorbedByLocal(amountFcfa)) return
    val app = context.applicationContext
    if (!canHearBle(app)) {
      if (wasSpoken(amountFcfa)) return
      speak(app, amountFcfa, lang, payerName)
      return
    }
    val pending =
      PendingServer(amountFcfa, Runnable {
        dropPending(amountFcfa)
        if (absorbedByLocal(amountFcfa) || wasSpoken(amountFcfa)) return@Runnable
        speak(app, amountFcfa, lang, payerName)
      })
    synchronized(pendingServer) { pendingServer.addLast(pending) }
    main.postDelayed(pending.run, BLE_WAIT_MS)
  }

  /** Bluetooth allumé et caisse à l'écoute : la voix instantanée peut encore arriver. */
  private fun canHearBle(context: Context): Boolean {
    if (!BlypShellBluetooth.isOn(context)) return false
    return CashierGattController.isRunning()
  }

  private fun speak(
    context: Context,
    amountFcfa: Int,
    lang: String,
    payerName: String?,
  ) {
    val now = System.currentTimeMillis()
    synchronized(spoken) {
      spoken.removeAll { it.second < now }
      spoken.addLast(amountFcfa to now + SPOKEN_MS)
      while (spoken.size > 40) spoken.removeFirst()
    }
    PaymentAnnounceService.start(context, amountFcfa, lang, payerName)
  }

  private fun rememberLocal(amountFcfa: Int) {
    synchronized(localAnnounced) {
      localAnnounced.addLast(amountFcfa to System.currentTimeMillis() + LOCAL_ABSORB_MS)
      while (localAnnounced.size > 40) localAnnounced.removeFirst()
    }
  }

  private fun cancelPendingServer(amountFcfa: Int) {
    val runs = ArrayList<Runnable>()
    synchronized(pendingServer) {
      val it = pendingServer.iterator()
      while (it.hasNext()) {
        val p = it.next()
        if (p.amount != amountFcfa) continue
        runs.add(p.run)
        it.remove()
      }
    }
    for (run in runs) main.removeCallbacks(run)
  }

  private fun dropPending(amountFcfa: Int) {
    synchronized(pendingServer) {
      val it = pendingServer.iterator()
      while (it.hasNext()) {
        if (it.next().amount == amountFcfa) {
          it.remove()
          return
        }
      }
    }
  }

  private fun wasSpoken(amountFcfa: Int): Boolean {
    val now = System.currentTimeMillis()
    synchronized(spoken) {
      spoken.removeAll { it.second < now }
      return spoken.any { it.first == amountFcfa }
    }
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
}
