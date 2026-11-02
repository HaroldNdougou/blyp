package com.haroldndougou.blyp.cashiergatt

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object CashierGattBridge {
  @Volatile
  var reactContext: ReactApplicationContext? = null

  fun emitReceipt(receiptJson: String) {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    map.putString("receiptJson", receiptJson)
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("cashierReceiptReceived", map)
  }

  fun emitError(code: String) {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    map.putString("code", code)
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("cashierGattError", map)
  }
}
