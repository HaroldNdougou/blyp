package com.haroldndougou.blyp.shell

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

data class ShellIncomingFlashEvent(
  val amountFcfa: Int,
  val transactionId: String?,
)

/** Flash encaissement commerce (équivalent `incomingFlash.ts`). */
object BlypShellIncomingFlash {
  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<(ShellIncomingFlashEvent) -> Unit>()

  fun subscribe(listener: (ShellIncomingFlashEvent) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  @Volatile private var lastKey = ""
  @Volatile private var lastAt = 0L

  fun notifyCommerceReceived(amountFcfa: Int, transactionId: String?) {
    if (amountFcfa <= 0) return
    val key = "${transactionId?.trim().orEmpty()}|$amountFcfa"
    val now = android.os.SystemClock.elapsedRealtime()
    if (key == lastKey && now - lastAt < 60_000L) return
    lastKey = key
    lastAt = now
    val event = ShellIncomingFlashEvent(amountFcfa, transactionId?.trim()?.ifEmpty { null })
    main.post {
      for (fn in listeners) {
        runCatching { fn(event) }
      }
    }
  }
}
