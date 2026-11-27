package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R

/** Recalcule l’aperçu liste depuis le fil local (ex. après suppression). */
object BlypShellConversationPreview {
  fun lastFromThread(
    context: Context,
    ownerPhone: String,
    conversationId: String,
    myUserId: String?,
  ): Pair<String, String>? {
    val phone = ownerPhone.trim()
    val cid = conversationId.trim()
    if (phone.isEmpty() || cid.isEmpty()) return null
    val bubbles =
      BlypShellChatMessagesStore.loadBubbles(context, phone, cid, myUserId)
    if (bubbles.isEmpty()) return "" to ""
    val last = bubbles.last()
    return previewFor(context, last) to last.createdAt
  }

  fun applyLocalThreadPreview(
    context: Context,
    ownerPhone: String,
    conv: org.json.JSONObject,
    myUserId: String?,
  ) {
    val cid = conv.optString("id").trim()
    if (cid.isEmpty()) return
    val fromThread = lastFromThread(context, ownerPhone, cid, myUserId)
    val localMeta =
      BlypShellChatMessagesStore.conversationMeta(context, ownerPhone.trim(), cid)
    when {
      fromThread != null && fromThread.first.isNotEmpty() -> {
        conv.put("lastMessagePreview", fromThread.first)
        conv.put("lastMessageAt", fromThread.second)
        conv.put("updatedAt", fromThread.second)
      }
      fromThread != null && fromThread.first.isEmpty() -> {
        conv.put("lastMessagePreview", "")
        conv.put("lastMessageAt", "")
      }
      localMeta != null -> {
        val localPrev = localMeta.optString("lastMessagePreview").trim()
        val localAt = localMeta.optString("lastMessageAt").trim()
        val serverAt = conv.optString("lastMessageAt").trim()
        if (localPrev.isEmpty() && localAt.isEmpty()) {
          conv.put("lastMessagePreview", "")
          conv.put("lastMessageAt", "")
        } else if (
          localPrev.isNotEmpty() &&
            (serverAt.isEmpty() || localAt <= serverAt)
        ) {
          conv.put("lastMessagePreview", localPrev)
          conv.put("lastMessageAt", localAt)
          conv.put("updatedAt", localAt.ifEmpty { conv.optString("updatedAt") })
        }
      }
    }
  }

  fun syncFromThread(
    context: Context,
    ownerPhone: String,
    conversationId: String,
    myUserId: String?,
  ) {
    val phone = ownerPhone.trim()
    val cid = conversationId.trim()
    if (phone.isEmpty() || cid.isEmpty()) return
    val meta =
      BlypShellChatMessagesStore.conversationMeta(context, phone, cid)
        ?: org.json.JSONObject().put("id", cid)
    val bubbles =
      BlypShellChatMessagesStore.loadBubbles(context, phone, cid, myUserId)
    if (bubbles.isEmpty()) {
      meta.put("lastMessagePreview", "")
      meta.put("lastMessageAt", "")
      meta.put("updatedAt", meta.optString("updatedAt").trim())
    } else {
      val last = bubbles.last()
      meta.put("lastMessagePreview", previewFor(context, last))
      meta.put("lastMessageAt", last.createdAt)
      meta.put("updatedAt", last.createdAt)
    }
    meta.put("id", cid)
    BlypShellConversationsStore.upsertOne(context, phone, meta)
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      BlypShellUiRefresh.notifyWalletChanged()
    }
  }

  fun previewFor(context: Context, row: ShellChatBubble): String =
    when (row.type) {
      "money" ->
        if (row.moneyAmountFcfa > 0) {
          context.getString(R.string.blyp_shell_chat_money_preview, row.moneyAmountFcfa)
        } else {
          context.getString(R.string.blyp_shell_chat_money_preview, 0).replace("0", "").trim()
            .ifEmpty { "💰" }
        }
      "voice" -> {
        val sec = ((row.voiceDurationMs.coerceAtLeast(1000)) / 1000).coerceAtLeast(1)
        context.getString(R.string.blyp_shell_chat_voice_preview, sec)
      }
      "image" -> {
        val cap = row.body.trim()
        when {
          cap.isEmpty() ||
            cap.equals("IMAGE", ignoreCase = true) ||
            cap.equals("Photo", ignoreCase = true) ->
            context.getString(R.string.blyp_shell_messages_photo_preview)
          else -> cap
        }
      }
      "document" -> {
        val name = row.documentFileName?.trim().orEmpty()
        if (name.isNotEmpty()) {
          if (name.length > 72) "📄 ${name.take(69)}…" else "📄 $name"
        } else {
          context.getString(R.string.blyp_shell_chat_type_document)
        }
      }
      else -> row.body.trim().ifEmpty { context.getString(R.string.blyp_shell_chat_type_other) }
    }
}