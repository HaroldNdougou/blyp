package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper

/** Delta historique + file offline — pendant que la coque est visible. */
object BlypShellBackgroundSync {
  private const val DELTA_MIN_MS = 55_000L
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var lastDeltaMs = 0L
  @Volatile private var running = false

  private val tickRunnable =
    object : Runnable {
      override fun run() {
        if (!running) return
        val ctx = BlypShellProductEngine.appContext ?: return
        val phone = BlypShellSession.phone(ctx)
        if (!phone.isNullOrEmpty()) {
          scheduleDelta(ctx, phone)
        }
        BlypShellOfflinePayQueue.flush(ctx)
        BlypShellPendingDeposit.tick(ctx)
        main.postDelayed(this, DELTA_MIN_MS)
      }
    }

  fun onShellForeground(context: Context) {
    BlypShellProductEngine.appContext = context.applicationContext
    if (running) return
    running = true
    val phone = BlypShellSession.phone(context)
    if (!phone.isNullOrEmpty()) {
      scheduleDelta(context.applicationContext, phone, force = true)
    }
    BlypShellOfflinePayQueue.flush(context.applicationContext)
    BlypShellBadgeNativeSync.refreshFromLocalCache(context.applicationContext)
    main.postDelayed(tickRunnable, DELTA_MIN_MS)
  }

  fun onShellBackground() {
    running = false
    main.removeCallbacks(tickRunnable)
  }

  fun scheduleDelta(context: Context, phone: String, force: Boolean = false) {
    val now = System.currentTimeMillis()
    if (!force && now - lastDeltaMs < DELTA_MIN_MS) return
    lastDeltaMs = now
    BlypHistoryDeltaSync.scheduleAfterHistoryPaint(context, phone, null)
  }
}

object BlypShellProductEngine {
  @Volatile var appContext: Context? = null

  fun onShellStarted(context: Context) {
    appContext = context.applicationContext
    /** Notification de paiement d’abord : c’est elle que l’utilisateur attend. */
    BlypShellQuickPayPref.attachShell(context)
    BlypShellReceivedPill.install(context.applicationContext as android.app.Application)
    BlypShellWalletRealtime.start(context)
    BlypShellChatOutbox.install(context)
    BlypShellBackgroundSync.onShellForeground(context)
    BlypShellTaxiBroadcast.attachShell(context)
  }

  fun onShellStopped(context: Context) {
    BlypShellBackgroundSync.onShellBackground()
    BlypShellWalletRealtime.stop()
  }
}
