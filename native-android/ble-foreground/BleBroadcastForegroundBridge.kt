package com.haroldndougou.blyp.bleforeground

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object BleBroadcastForegroundBridge {
  @Volatile
  var reactContext: ReactApplicationContext? = null

  private val shellStopListeners = java.util.concurrent.CopyOnWriteArraySet<() -> Unit>()

  fun registerShellStopListener(listener: () -> Unit): () -> Unit {
    shellStopListeners.add(listener)
    return { shellStopListeners.remove(listener) }
  }

  fun emitStopRequested() {
    for (fn in shellStopListeners) {
      runCatching { fn() }
    }
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypBleForegroundStop", null)
  }
}
