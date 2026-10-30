package com.haroldndougou.blyp.quickpaynotif

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object QuickPayNotifBridge {
  @Volatile
  var reactContext: ReactApplicationContext? = null

  fun emitPayRequested(context: Context, amountFcfa: Int) {
    if (amountFcfa <= 0) return
    QuickPayPendingStore.set(context, amountFcfa)
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap().apply {
      putInt("amountFcfa", amountFcfa)
    }
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypQuickPayRequested", map)
  }

  fun emitPayCompleted(
    context: Context,
    amountFcfa: Int,
    balanceFcfa: Int,
    transactionId: String?,
  ) {
    val ctx = reactContext
    if (ctx == null || !ctx.hasActiveReactInstance()) return
    val map =
      Arguments.createMap().apply {
        putInt("amountFcfa", amountFcfa)
        putInt("balanceFcfa", balanceFcfa)
        putString("transactionId", transactionId)
      }
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypQuickPayCompleted", map)
  }
}
