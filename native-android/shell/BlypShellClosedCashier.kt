package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.cashiergatt.CashierGattBridge
import com.haroldndougou.blyp.cashiergatt.CashierGattController
import com.haroldndougou.blyp.paymentannounce.PaymentAnnounceEngine
import com.haroldndougou.blyp.paymentannounce.PaymentAnnouncePrefs
import kotlin.random.Random

/** GATT caisse — écoute les paiements à proximité (annonce immédiate + preuve serveur après). */
object BlypShellClosedCashier {
  @Volatile private var sessionId: Int = 0
  @Volatile private var retryPosted = false
  @Volatile private var btRetries = 0
  /** Écran commerce ouvert ; sinon la caisse tourne tant que la diffusion « En ligne » est active. */
  @Volatile private var screenActive = false
  private val main = android.os.Handler(android.os.Looper.getMainLooper())

  private fun onReceiptJson(json: String) {
    val ctx = BlypShellProductEngine.appContext ?: return
    BlypShellCommerceReceiptHandler.handleReceiptJson(ctx, json)
  }

  fun merchantSessionId(): Int = sessionId

  fun syncForCommerceScreen(context: Context) {
    screenActive = true
    ensureRunning(context)
  }

  fun onScreenGone(context: Context) {
    screenActive = false
    if (!BlypShellTaxiBroadcast.snapshot(context.applicationContext).wantOn) stop(context)
  }

  fun onBroadcastOff(context: Context) {
    if (!screenActive) stop(context)
  }

  /** Démarre la caisse (réception des paiements à proximité) si elle ne tourne pas. */
  fun ensureRunning(context: Context, fromBroadcast: Boolean = false) {
    val ctx = context.applicationContext
    val accountId =
      BlypShellBleAccount.resolveForBroadcast(ctx)?.accountId?.trim()?.uppercase().orEmpty()
        .ifEmpty { BlypShellSession.accountId(ctx)?.trim()?.uppercase().orEmpty() }
    if (accountId.isEmpty()) {
      stop(ctx)
      return
    }
    if (sessionId == 0) {
      sessionId = Random.nextInt().toUInt().toInt()
    }
    CashierGattBridge.registerShellReceiptListener(::onReceiptJson)
    if (PaymentAnnouncePrefs.isEnabled(ctx)) PaymentAnnounceEngine.startKeepWarm(ctx)
    val identity =
      if (BlypShellTaxiBroadcast.snapshot(ctx).wantOn) {
        BlypShellBleAccount.resolveForBroadcast(ctx)?.let {
          BlypShellBlePayload.encodeManufBytes(it.accountId, it.phone, it.category)
        }
      } else {
        null
      }
    if (CashierGattController.isRunning() &&
      !CashierGattController.merchantAccountId().equals(accountId, ignoreCase = true)
    ) {
      CashierGattController.stop(ctx)
    }
    if (!CashierGattController.isRunning()) {
      if (!BlypShellBluetooth.ensureOnSilently(ctx) &&
        BlypShellBluetooth.canEnableSilently() &&
        btRetries < 3
      ) {
        if (!retryPosted) {
          retryPosted = true
          btRetries++
          main.postDelayed({
            retryPosted = false
            if (sessionId != 0) ensureRunning(ctx, fromBroadcast)
          }, 2_500L)
        }
        return
      }
      btRetries = 0
      if (CashierGattController.start(ctx, sessionId, accountId, identity) && !fromBroadcast) {
        BlypShellTaxiBroadcast.reapply(ctx)
      }
    } else {
      CashierGattController.setIdentity(identity)
    }
  }

  fun stop(context: Context) {
    CashierGattBridge.unregisterShellReceiptListener(::onReceiptJson)
    PaymentAnnounceEngine.stopKeepWarm()
    val wasRunning = CashierGattController.isRunning()
    CashierGattController.stop(context.applicationContext)
    sessionId = 0
    if (wasRunning) BlypShellTaxiBroadcast.reapply(context)
  }
}
