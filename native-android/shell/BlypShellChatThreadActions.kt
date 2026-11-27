package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

object BlypShellChatThreadActions {
  private val main = Handler(Looper.getMainLooper())

  fun deleteAsync(
    context: Context,
    conversationId: String,
    messageId: String,
    scope: String,
    onFinished: (ok: Boolean, tooLate: Boolean) -> Unit,
  ) {
    Thread {
        val (ok, tooLate) =
          try {
            BlypShellChatPresign.postDelete(context, conversationId, messageId, scope)
          } catch (_: Exception) {
            false to false
          }
        main.post { onFinished(ok, tooLate) }
      }
      .start()
  }

  fun reactAsync(
    context: Context,
    conversationId: String,
    messageId: String,
    emoji: String?,
    onFinished: (reactions: List<ShellChatReaction>?, ok: Boolean) -> Unit,
  ) {
    Thread {
        var ok = false
        var reactions: List<ShellChatReaction>? = null
        try {
          val body =
            JSONObject()
              .put("type", "react")
              .put("messageId", messageId)
          if (emoji != null) body.put("emoji", emoji) else body.put("emoji", JSONObject.NULL)
          val res = BlypShellChatPresign.post(context, conversationId, body)
          ok = res != null
          if (res != null) {
            reactions = BlypShellChatMessagesStore.parseReactions(res.optJSONArray("reactions"))
          }
        } catch (_: Exception) {
          ok = false
        }
        main.post { onFinished(reactions, ok) }
      }
      .start()
  }
}