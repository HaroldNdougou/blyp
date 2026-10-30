package com.haroldndougou.blyp.quickpaynotif

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class QuickPayNotifModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx) {
  init {
    QuickPayNotifBridge.reactContext = ctx
  }

  override fun getName(): String = "BlypQuickPayNotif"

  @ReactMethod
  fun start(
    title: String,
    body: String,
    l50: String,
    l100: String,
    l200: String,
    l500: String,
    promise: Promise,
  ) {
    try {
      QuickPayNotifService.start(ctx, title, body, l50, l100, l200, l500)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("QUICK_PAY_FGS", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      QuickPayNotifService.stop(ctx)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("QUICK_PAY_STOP", e.message, e)
    }
  }

  @ReactMethod
  fun clearHighlight(promise: Promise) {
    try {
      QuickPayNotifService.clearHighlight(ctx)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("QUICK_PAY_CLEAR", e.message, e)
    }
  }

  @ReactMethod
  fun consumePendingQuickPay(promise: Promise) {
    try {
      promise.resolve(QuickPayPendingStore.take(ctx))
    } catch (e: Exception) {
      promise.reject("QUICK_PAY_PENDING", e.message, e)
    }
  }

  @ReactMethod
  fun syncRuntimeSecrets(
    apiBaseUrl: String,
    accessToken: String,
    recipientJson: String,
    transactionPin: String,
    balanceFcfa: Double,
    phoneDigits: String,
    promise: Promise,
  ) {
    try {
      QuickPayNativeSecrets.sync(
        ctx,
        apiBaseUrl,
        accessToken,
        recipientJson,
        transactionPin,
        balanceFcfa.toInt(),
        phoneDigits,
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("QUICK_PAY_SYNC", e.message, e)
    }
  }

  @ReactMethod
  fun clearRuntimeSecrets(promise: Promise) {
    try {
      QuickPayNativeSecrets.clear(ctx)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("QUICK_PAY_CLEAR_SECRETS", e.message, e)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
