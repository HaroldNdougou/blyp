package com.haroldndougou.blyp.shell

import android.content.Context

/** PIN pour Pay natif après connexion (sans React). */
object BlypShellPayBootstrap {
  fun hasTransactionPin(context: Context): Boolean {
    val pin =
      BlypShellPayRuntime.readPinOnly(context.applicationContext)?.replace(Regex("\\D"), "")
        .orEmpty()
    return pin.length == 4
  }

  fun needsPinBootstrap(context: Context): Boolean {
    val app = context.applicationContext
    if (!BlypShellSession.hasValidSession(app)) return false
    if (BlypShellSession.needsOnboarding(app)) return false
    return !hasTransactionPin(app)
  }

  fun applyLocalPin(context: Context, pinDigits: String) {
    val pin = pinDigits.replace(Regex("\\D"), "")
    if (pin.length != 4) return
    val bal = BlypShellSession.profile(context.applicationContext)?.balanceFcfa ?: 0
    BlypShellPayRuntime.syncTransactionPin(context.applicationContext, pin, bal)
    BlypShellJsAuthPending.enqueuePin(context.applicationContext, pin)
  }
}
