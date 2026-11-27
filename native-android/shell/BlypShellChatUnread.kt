package com.haroldndougou.blyp.shell

import android.content.Context

/** Messages non lus par discussion, tant que l’utilisateur n’est pas dans le chat. */
object BlypShellChatUnread {
  private const val PREFS = "blyp_shell_chat_unread"

  fun count(context: Context, conversationId: String): Int {
    val id = conversationId.trim()
    if (id.isEmpty()) return 0
    return prefs(context).getInt(id, 0).coerceAtLeast(0)
  }

  fun bump(context: Context, conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val p = prefs(context)
    p.edit().putInt(id, p.getInt(id, 0).coerceAtLeast(0) + 1).apply()
  }

  fun clear(context: Context, conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val p = prefs(context)
    val n = p.getInt(id, 0).coerceAtLeast(0)
    p.edit().remove(id).commit()
    com.haroldndougou.blyp.paymentannounce.MessagePushPresenter.dismiss(context, id)
    if (n > 0) {
      val left = (BlypShellSession.messagesUnread(context) - n).coerceAtLeast(0)
      BlypShellBadgeNativeSync.applyMessagesUnread(context, left)
    }
    BlypShellUiRefresh.notifyMessagesBadgeChanged()
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
