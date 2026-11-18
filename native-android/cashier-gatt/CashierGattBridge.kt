package com.haroldndougou.blyp.cashiergatt

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object CashierGattBridge {
  @Volatile
  var reactContext: ReactApplicationContext? = null

  private val shellListeners = java.util.concurrent.CopyOnWriteArraySet<(String) -> Unit>()

  fun registerShellReceiptListener(listener: (String) -> Unit) {
    shellListeners.add(listener)
  }

  fun unregisterShellReceiptListener(listener: (String) -> Unit) {
    shellListeners.remove(listener)
  }

  fun emitReceipt(receiptJson: String) {
    if (shellListeners.isNotEmpty()) {
      for (fn in shellListeners) {
        runCatching { fn(receiptJson) }
      }
    }
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
