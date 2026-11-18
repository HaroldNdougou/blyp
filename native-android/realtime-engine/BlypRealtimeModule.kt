package com.haroldndougou.blyp.realtime

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BlypRealtimeModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx) {
  private val engine = BlypRealtimeEngine(ctx)

  override fun getName(): String = "BlypRealtimeEngine"

  @ReactMethod
  fun start(wsUrl: String, accessToken: String, promise: Promise) {
    try {
      engine.start(wsUrl, accessToken)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("REALTIME_START", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      engine.stop()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("REALTIME_STOP", e.message, e)
    }
  }

  @ReactMethod
  fun sendActionJson(json: String, promise: Promise) {
    try {
      engine.sendActionJson(json)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("REALTIME_SEND", e.message, e)
    }
  }

  @ReactMethod
  fun sendFrameBase64(b64: String, promise: Promise) {
    try {
      engine.sendFrameBase64(b64)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("REALTIME_FRAME", e.message, e)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
