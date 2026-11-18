package com.haroldndougou.blyp.shell

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

object BlypShellBridge {
  @Volatile
  var reactContext: ReactApplicationContext? = null

  @Volatile
  private var pendingPayCompleted: PayCompletedPayload? = null

  data class PayCompletedPayload(
    val amountFcfa: Int,
    val balanceFcfa: Int,
    val transactionId: String?,
    val recipientAccountId: String?,
    val recipientName: String?,
    val recipientPhone: String?,
    val paymentReceiptJson: String? = null,
  )

  fun emitNativePayCompleted(
    amountFcfa: Int,
    balanceFcfa: Int,
    transactionId: String?,
    recipientAccountId: String?,
    recipientName: String?,
    recipientPhone: String?,
    paymentReceiptJson: String? = null,
  ) {
    pendingPayCompleted =
      PayCompletedPayload(
        amountFcfa,
        balanceFcfa,
        transactionId,
        recipientAccountId,
        recipientName,
        recipientPhone,
        paymentReceiptJson?.trim()?.takeIf { it.isNotEmpty() },
      )
    BlypShellUiRefresh.notifyWalletChanged()
    tryEmitLive()
  }

  fun takePendingPayCompleted(): PayCompletedPayload? {
    val p = pendingPayCompleted ?: return null
    pendingPayCompleted = null
    return p
  }

  fun flushPendingPayCompletedToJs() {
    tryEmitLive()
  }

  private fun tryEmitLive() {
    val payload = pendingPayCompleted ?: return
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    val map =
      Arguments.createMap().apply {
        putInt("amountFcfa", payload.amountFcfa)
        putInt("balanceFcfa", payload.balanceFcfa)
        putString("transactionId", payload.transactionId)
        putString("recipientAccountId", payload.recipientAccountId)
        putString("recipientName", payload.recipientName)
        putString("recipientPhone", payload.recipientPhone)
        putString("paymentReceiptJson", payload.paymentReceiptJson)
      }
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypShellPayCompleted", map)
    pendingPayCompleted = null
  }

  /** Forward chat/wallet frames vers React si l’îlot est monté (Messages). */
  fun emitRealtimePayload(data: JSONObject) {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    val map =
      Arguments.createMap().apply {
        putString("json", data.toString())
      }
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypShellRealtimePayload", map)
  }
}
