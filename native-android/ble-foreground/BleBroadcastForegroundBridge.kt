package com.haroldndougou.blyp.bleforeground

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object BleBroadcastForegroundBridge {
  @Volatile
  var reactContext: ReactApplicationContext? = null

  fun emitStopRequested() {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypBleForegroundStop", null)
  }
}
