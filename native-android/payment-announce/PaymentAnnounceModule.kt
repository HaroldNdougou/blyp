package com.haroldndougou.blyp.paymentannounce

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class PaymentAnnounceModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx) {
  init {
    reactCtx = ctx
  }

  override fun getName(): String = "BlypPaymentAnnounce"

  @ReactMethod
  fun setActiveConversation(conversationId: String?, promise: Promise) {
    try {
      PaymentAnnouncePrefs.setActiveConversation(ctx, conversationId)
      val id = conversationId?.trim().orEmpty()
      if (id.isNotEmpty()) {
        MessagePushPresenter.dismiss(ctx, id)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ACTIVE_CONV", e.message, e)
    }
  }

  @ReactMethod
  fun setEnabled(enabled: Boolean, promise: Promise) {
    try {
      PaymentAnnouncePrefs.setEnabled(ctx, enabled)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ANNOUNCE_PREF", e.message, e)
    }
  }

  @ReactMethod
  fun setLanguage(lang: String, promise: Promise) {
    try {
      PaymentAnnouncePrefs.setLang(ctx, lang)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ANNOUNCE_LANG", e.message, e)
    }
  }

  @ReactMethod
  fun announce(amountFcfa: Int, lang: String, txId: String?, promise: Promise) {
    try {
      PaymentAnnounceController.announceFromJs(ctx, amountFcfa, lang, txId)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ANNOUNCE", e.message, e)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  companion object {
    @Volatile
    private var reactCtx: ReactApplicationContext? = null

    fun emitPaymentReceived(data: Map<String, String>) {
      val ctx = reactCtx ?: return
      if (!ctx.hasActiveReactInstance()) return
      ctx.runOnUiQueueThread {
        try {
          val map = Arguments.createMap()
          for ((k, v) in data) map.putString(k, v)
          ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("blyp_payment_received", map)
        } catch (_: Exception) {
        }
      }
    }

    fun emitIncomingMessage(conversationId: String) {
      val id = conversationId.trim()
      if (id.isEmpty()) return
      val ctx = reactCtx ?: return
      if (!ctx.hasActiveReactInstance()) return
      ctx.runOnUiQueueThread {
        try {
          ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("blyp_message_received", id)
        } catch (_: Exception) {
        }
      }
    }
  }
}
