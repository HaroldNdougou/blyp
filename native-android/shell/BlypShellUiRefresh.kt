package com.haroldndougou.blyp.shell

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

/** Rafraîchir Pay / Historique / Profil après paiement natif sans changer d’onglet. */
object BlypShellUiRefresh {
  private val listeners = CopyOnWriteArraySet<() -> Unit>()
  private val main = Handler(Looper.getMainLooper())

  fun subscribe(listener: () -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun notifyWalletChanged() {
    main.post {
      for (fn in listeners) {
        runCatching { fn() }
      }
    }
  }

  private val badgeListeners = CopyOnWriteArraySet<() -> Unit>()

  fun subscribeShellBadges(listener: () -> Unit): () -> Unit {
    badgeListeners.add(listener)
    return { badgeListeners.remove(listener) }
  }

  fun subscribeMessagesBadge(listener: () -> Unit): () -> Unit = subscribeShellBadges(listener)

  fun notifyShellBadgesChanged() {
    main.post {
      for (fn in badgeListeners) {
        runCatching { fn() }
      }
    }
  }

  fun notifyMessagesBadgeChanged() = notifyShellBadgesChanged()

  private val chatListeners = CopyOnWriteArraySet<(String) -> Unit>()

  fun subscribeChat(listener: (conversationId: String) -> Unit): () -> Unit {
    chatListeners.add(listener)
    return { chatListeners.remove(listener) }
  }

  fun notifyChatChanged(conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    main.post {
      for (fn in chatListeners) {
        runCatching { fn(id) }
      }
    }
  }
}
