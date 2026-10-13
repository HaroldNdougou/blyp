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
  fun setApiSession(apiBase: String?, accessToken: String?, promise: Promise) {
    try {
      PaymentAnnouncePrefs.setApiSession(ctx, apiBase, accessToken)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("API_SESSION", e.message, e)
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

    fun hasActiveReact(): Boolean {
      val ctx = reactCtx ?: return false
      return ctx.hasActiveReactInstance()
    }

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

    fun emitIncomingMessage(data: Map<String, String>) {
      val conversationId = data["conversationId"]?.trim().orEmpty()
      if (conversationId.isEmpty()) return
      val ctx = reactCtx ?: return
      if (!ctx.hasActiveReactInstance()) return
      ctx.runOnUiQueueThread {
        try {
          val map = Arguments.createMap()
          for ((k, v) in data) map.putString(k, v)
          if (!map.hasKey("conversationId")) {
            map.putString("conversationId", conversationId)
          }
          ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("blyp_message_received", map)
        } catch (_: Exception) {
        }
      }
    }

    fun emitMoneyClaimed(data: Map<String, String>) {
      val conversationId = data["conversationId"]?.trim().orEmpty()
      val transferId = data["transferId"]?.trim().orEmpty()
      if (conversationId.isEmpty() || transferId.isEmpty()) return
      val ctx = reactCtx ?: return
      if (!ctx.hasActiveReactInstance()) return
      ctx.runOnUiQueueThread {
        try {
          val map = Arguments.createMap()
          for ((k, v) in data) map.putString(k, v)
          ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("blyp_money_claimed", map)
        } catch (_: Exception) {
        }
      }
    }

    fun emitConversationReceipt(data: Map<String, String>) {
      val conversationId = data["conversationId"]?.trim().orEmpty()
      val at = data["at"]?.trim().orEmpty()
      if (conversationId.isEmpty() || at.isEmpty()) return
      emitMap("blyp_conversation_receipt", data)
    }

    fun emitConversationTyping(data: Map<String, String>) {
      val conversationId = data["conversationId"]?.trim().orEmpty()
      if (conversationId.isEmpty()) return
      emitMap("blyp_conversation_typing", data)
    }

    fun emitMoneyUpdated(data: Map<String, String>) {
      val conversationId = data["conversationId"]?.trim().orEmpty()
      val transferId = data["transferId"]?.trim().orEmpty()
      if (conversationId.isEmpty() || transferId.isEmpty()) return
      emitMap("blyp_money_updated", data)
    }

    fun emitMoneyTray(data: Map<String, String>) {
      val conversationId = data["conversationId"]?.trim().orEmpty()
      val transferId = data["transferId"]?.trim().orEmpty()
      if (conversationId.isEmpty() || transferId.isEmpty()) return
      emitMap("blyp_money_tray", data)
    }

    private fun emitMap(event: String, data: Map<String, String>) {
      val ctx = reactCtx ?: return
      if (!ctx.hasActiveReactInstance()) return
      ctx.runOnUiQueueThread {
        try {
          val map = Arguments.createMap()
          for ((k, v) in data) map.putString(k, v)
          ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, map)
        } catch (_: Exception) {
        }
      }
    }
  }
}
