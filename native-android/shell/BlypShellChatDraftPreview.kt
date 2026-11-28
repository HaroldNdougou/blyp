package com.haroldndougou.blyp.shell

import android.content.Context

/** Met à jour l’aperçu liste quand le brouillon change. */
object BlypShellChatDraftPreview {
  fun syncList(context: Context, conversationId: String) {
    val owner = BlypShellSession.phone(context)?.trim().orEmpty()
    val id = conversationId.trim()
    if (owner.isEmpty() || id.isEmpty()) return
    val line = BlypShellChatDraft.listPreviewLine(context, id)
    val meta =
      BlypShellChatMessagesStore.conversationMeta(context, owner, id)
        ?: run {
          org.json.JSONObject().put("id", id)
        }
    if (line.isNullOrEmpty()) {
      meta.remove("draftPreview")
    } else {
      meta.put("draftPreview", line)
      meta.put("shellKeepInList", true)
    }
    val at = java.time.Instant.now().toString()
    if (meta.optString("updatedAt").trim().isEmpty()) meta.put("updatedAt", at)
    BlypShellConversationsStore.upsertOne(context, owner, meta)
    BlypShellUiRefresh.notifyShellBadgesChanged()
  }
}