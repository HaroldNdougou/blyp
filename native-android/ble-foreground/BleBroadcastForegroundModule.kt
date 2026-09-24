package com.haroldndougou.blyp.bleforeground

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BleBroadcastForegroundModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx) {
  init {
    BleBroadcastForegroundBridge.reactContext = ctx
  }

  override fun getName(): String = "BlypBleForeground"

  @ReactMethod
  fun start(title: String, body: String, stopLabel: String, promise: Promise) {
    try {
      BleBroadcastForegroundService.start(ctx, title, body, stopLabel)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("FGS_START", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      BleBroadcastForegroundService.stop(ctx)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("FGS_STOP", e.message, e)
    }
  }

  /** Requis pour NativeEventEmitter (RN 0.65+). */
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
