package com.haroldndougou.blyp.shell

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BlypNativeShellModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx) {
  init {
    BlypShellBridge.reactContext = ctx
  }

  override fun getName(): String = "BlypNativeShell"

  @ReactMethod
  fun consumeShellPayCompleted(promise: Promise) {
    try {
      val p = BlypShellBridge.takePendingPayCompleted()
      if (p == null) {
        promise.resolve(null)
        return
      }
      promise.resolve(
        Arguments.createMap().apply {
          putInt("amountFcfa", p.amountFcfa)
          putInt("balanceFcfa", p.balanceFcfa)
          putString("transactionId", p.transactionId)
          putString("recipientAccountId", p.recipientAccountId)
          putString("recipientName", p.recipientName)
          putString("recipientPhone", p.recipientPhone)
          putString("paymentReceiptJson", p.paymentReceiptJson)
        },
      )
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun consumeShellLaunch(promise: Promise) {
    try {
      val map = BlypShellLaunchBridge.consumeLaunchPayload()
      if (map == null) promise.resolve(null)
      else promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun syncSession(
    phone: String?,
    accountId: String?,
    signedIn: Boolean,
    displayName: String?,
    balanceFcfa: Double,
    avatarUrl: String?,
    apiBaseUrl: String?,
    accessToken: String?,
    assetsCdnUrl: String?,
    realtimeWsUrl: String?,
    isCommerceMode: Boolean,
    kycStatus: String?,
    needsOnboarding: Boolean,
    promise: Promise,
  ) {
    try {
      BlypShellSession.sync(
        ctx.applicationContext,
        phone,
        accountId,
        signedIn,
        displayName,
        balanceFcfa.toInt(),
        avatarUrl,
        isCommerceMode,
        kycStatus,
        needsOnboarding,
      )
      if (signedIn && balanceFcfa >= 0) {
        BlypShellPayRuntime.updateBalance(ctx.applicationContext, balanceFcfa.toInt())
      }
      BlypShellRuntime.sync(
        ctx.applicationContext,
        apiBaseUrl,
        if (signedIn) accessToken else null,
        assetsCdnUrl,
      )
      if (signedIn) {
        BlypShellAuthMirror.persist(
          ctx.applicationContext,
          phone,
          accountId,
          true,
          displayName,
          balanceFcfa.toInt(),
          avatarUrl,
          apiBaseUrl,
          accessToken,
          assetsCdnUrl,
          realtimeWsUrl,
          isCommerceMode,
          kycStatus,
          needsOnboarding,
        )
      } else {
        BlypShellAuthMirror.clear(ctx.applicationContext)
      }
      BlypShellUiRefresh.notifyWalletChanged()
      if (signedIn) {
        BlypShellPayDossierStore.refreshFromSources(ctx.applicationContext)
      } else {
        BlypShellPayDossierStore.clear(ctx.applicationContext)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun syncInstallDeviceId(installDeviceId: String?, promise: Promise) {
    try {
      BlypShellInstallDevice.adoptFromJs(ctx.applicationContext, installDeviceId)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun persistAuthMirror(
    phone: String?,
    accountId: String?,
    signedIn: Boolean,
    displayName: String?,
    balanceFcfa: Double,
    avatarUrl: String?,
    apiBaseUrl: String?,
    accessToken: String?,
    assetsCdnUrl: String?,
    realtimeWsUrl: String?,
    isCommerceMode: Boolean,
    kycStatus: String?,
    needsOnboarding: Boolean,
    promise: Promise,
  ) {
    try {
      BlypShellAuthMirror.persist(
        ctx.applicationContext,
        phone,
        accountId,
        signedIn,
        displayName,
        balanceFcfa.toInt(),
        avatarUrl,
        apiBaseUrl,
        accessToken,
        assetsCdnUrl,
        realtimeWsUrl,
        isCommerceMode,
        kycStatus,
        needsOnboarding,
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun clearAuthMirror(promise: Promise) {
    try {
      BlypShellAuthMirror.clear(ctx.applicationContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun syncPayConfig(
    recipientJson: String?,
    candidatesJson: String?,
    transactionPin: String?,
    balanceFcfa: Double,
    promise: Promise,
  ) {
    try {
      BlypShellPayRuntime.sync(
        ctx.applicationContext,
        recipientJson?.trim().orEmpty(),
        candidatesJson?.trim().orEmpty(),
        transactionPin?.trim().orEmpty(),
        balanceFcfa.toInt(),
      )
      BlypShellUiRefresh.notifyWalletChanged()
      BlypShellPayDossierStore.refreshFromSources(ctx.applicationContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun syncMessagesUnread(count: Double, promise: Promise) {
    try {
      BlypShellBadgeNativeSync.applyMessagesUnread(
        ctx.applicationContext,
        count.toInt(),
        writeKv = true,
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun syncReceiptsUnread(count: Double, promise: Promise) {
    try {
      BlypShellSession.syncReceiptsUnread(ctx.applicationContext, count.toInt())
      BlypShellUiRefresh.notifyShellBadgesChanged()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun noteServerTime(serverMs: Double, promise: Promise) {
    BlypShellDeviceKey.noteServerTime(serverMs.toLong())
    promise.resolve(null)
  }

  /** Îlot RN : signature d’une action d’argent par la clé appareil (jamais exportée vers JS). */
  @ReactMethod
  fun signDeviceRequest(method: String, path: String, body: String?, promise: Promise) {
    try {
      val proof = BlypShellDeviceKey.requestProof(method, path, body.orEmpty())
      if (proof == null) {
        promise.resolve(null)
        return
      }
      promise.resolve(
        Arguments.createMap().apply {
          putString("ts", proof.first)
          putString("sig", proof.second)
        },
      )
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  /** Îlot RN : la coque est seule à faire tourner le refresh (sinon famille révoquée). */
  @ReactMethod
  fun refreshSessionFromShell(jsAccess: String?, jsRefresh: String?, promise: Promise) {
    val app = ctx.applicationContext
    Thread {
      try {
        val t = BlypShellSessionRefresh.refreshForJs(app, jsAccess, jsRefresh)
        if (t == null) {
          promise.resolve(null)
        } else {
          promise.resolve(
            Arguments.createMap().apply {
              putString("token", t.accessToken)
              putString("refreshToken", t.refreshToken)
            },
          )
        }
      } catch (e: Exception) {
        promise.reject("BLYP_SHELL", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun consumeShellAuthForJs(promise: Promise) {
    try {
      val pending = BlypShellJsAuthPending.consume(ctx.applicationContext)
      if (pending == null) {
        promise.resolve(null)
        return
      }
      promise.resolve(
        Arguments.createMap().apply {
          putString("accessToken", pending.accessToken)
          putString("refreshToken", pending.refreshToken)
          putString("userJson", pending.userJson)
          putString("pendingPin", pending.pendingPin)
        },
      )
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun hideMessagesLoading(promise: Promise) {
    try {
      val act = ctx.currentActivity
      if (act != null) {
        act.runOnUiThread { BlypShellMessagesLoading.hide(act) }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun returnToNativeShell(promise: Promise) {
    try {
      val act = ctx.currentActivity
      if (act == null) {
        promise.reject("BLYP_SHELL", "NO_ACTIVITY")
        return
      }
      act.startActivity(
        Intent(act, BlypNativeShellActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        },
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }

  @ReactMethod
  fun openNativeShell(promise: Promise) {
    try {
      val act = ctx.currentActivity
      if (act == null) {
        promise.reject("BLYP_SHELL", "NO_ACTIVITY")
        return
      }
      act.startActivity(
        Intent(act, BlypNativeShellActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        },
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BLYP_SHELL", e.message, e)
    }
  }
}
