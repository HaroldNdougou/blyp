package com.haroldndougou.blyp.shell

import android.content.Context

/** Déconnexion coque — sans ouvrir React. */
object BlypShellAuthSignOut {
  fun perform(context: Context) {
    val app = context.applicationContext
    BlypShellPush.unregisterAsync(app)
    BlypShellTaxiBroadcast.setWantOn(app, false)
    BlypShellQuickPayPref.onSignOut(app)
    BlypShellWalletRealtime.stop()
    BlypShellClosedCashier.stop(app)
    BlypShellOfflinePayQueue.clearAll(app)
    val accountId = BlypShellSession.accountId(app)?.trim().orEmpty()
    if (accountId.isNotEmpty()) {
      BlypShellKvCache.writeMessagesUnreadTotal(app, accountId, 0)
    }
    BlypShellSession.clear(app)
  }
}
