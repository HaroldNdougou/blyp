package com.haroldndougou.blyp.cashiergatt

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class CashierGattModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx) {
  init {
    CashierGattBridge.reactContext = ctx
  }

  override fun getName(): String = "BlypCashierGatt"

  @ReactMethod
  fun startClosedCashier(sessionId: Int, merchantAccountId: String, promise: Promise) {
    try {
      val ok =
        CashierGattController.start(
          ctx.applicationContext,
          sessionId,
          merchantAccountId,
        )
      if (ok) promise.resolve(null) else promise.reject("START", "Gatt caisse indisponible")
    } catch (e: Exception) {
      promise.reject("START", e.message, e)
    }
  }

  @ReactMethod
  fun stopClosedCashier(promise: Promise) {
    try {
      CashierGattController.stop(ctx.applicationContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("STOP", e.message, e)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
