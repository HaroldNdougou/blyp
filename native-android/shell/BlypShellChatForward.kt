package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object BlypShellChatForward {
  fun forwardAsync(
    context: Context,
    sourceConversationId: String,
    targetConversationId: String,
    messageIds: List<String>,
    onFinished: (ok: Boolean) -> Unit,
  ) {
    if (messageIds.isEmpty()) {
      onFinished(false)
      return
    }
    Thread {
        var ok = false
        try {
          val clientIds = JSONObject()
          for (id in messageIds) {
            clientIds.put(id, UUID.randomUUID().toString())
          }
          val body =
            JSONObject()
              .put("type", "forward")
              .put("sourceConversationId", sourceConversationId.trim())
              .put("messageIds", JSONArray(messageIds))
              .put("clientIds", clientIds)
          val res =
            BlypShellChatPresign.post(context, targetConversationId, body)
          ok = res != null
        } catch (_: Exception) {
          ok = false
        }
        Handler(Looper.getMainLooper()).post { onFinished(ok) }
      }
      .start()
  }
}