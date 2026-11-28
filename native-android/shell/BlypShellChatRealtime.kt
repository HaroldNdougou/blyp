package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.paymentannounce.PaymentAnnouncePrefs
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/** WS `message_received` pour fil / liste natifs (sans îlot RN). */
object BlypShellChatRealtime {
  private val threadListeners = CopyOnWriteArraySet<(String) -> Unit>()
  private val listListeners = CopyOnWriteArraySet<() -> Unit>()
  private val main = Handler(Looper.getMainLooper())
  private val seen = LinkedHashSet<String>()

  fun subscribeThread(listener: (conversationId: String) -> Unit): () -> Unit {
    threadListeners.add(listener)
    return { threadListeners.remove(listener) }
  }

  fun subscribeList(listener: () -> Unit): () -> Unit {
    listListeners.add(listener)
    return { listListeners.remove(listener) }
  }

  fun poke(conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    main.post {
      for (fn in threadListeners) {
        runCatching { fn(id) }
      }
    }
  }

  fun dispatch(context: Context, data: JSONObject) {
    if (ingest(context, data)) {
      val map = HashMap<String, String>()
      val keys = data.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        val value = data.opt(key)
        if (value != null && value != org.json.JSONObject.NULL) map[key] = value.toString()
      }
      com.haroldndougou.blyp.paymentannounce.MessagePushPresenter.showIncoming(context, map)
    }
  }

  /** Enregistre le message et prévient la liste. Vrai s’il faut afficher la notification. */
  fun ingest(context: Context, data: JSONObject): Boolean {
    if (data.optString("type") != "message_received") return false
    val convId = data.optString("conversationId").trim()
    if (convId.isEmpty()) return false
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return false
    val msg = data.optJSONObject("message") ?: messageFromWsFields(data)
    if (msg != null) {
      val hollow = BlypShellChatMessagesStore.isHollow(msg)
      val voice = msg.optString("type") == "voice"
      if (!hollow || voice) {
        BlypShellChatMessagesStore.upsertMessages(context, phone, convId, listOf(msg))
      }
      if (hollow) BlypShellChatThreadSync.pullNow(context, phone, convId, null)
      val at = msg.optString("createdAt").trim().ifEmpty { java.time.Instant.now().toString() }
      val typeName = msg.optString("type").trim().ifEmpty { data.optString("messageType").trim() }
      val body = msg.optString("body").trim().ifEmpty { data.optString("body").trim() }
      val reaction = BlypShellReactionCodec.parse(body)
      val preview =
        when {
          reaction != null -> {
            val emoji = reaction.second
            if (emoji.isEmpty()) ""
            else {
              val name = data.optString("fromName").trim().substringBefore(' ')
              BlypShellReactionCodec.listPreview(emoji, mine = false, reactorFirstName = name)
            }
          }
          else ->
            BlypShellPlaceCodec.previewFromBody(
              body,
              context.getString(R.string.blyp_shell_chat_place_preview_live),
              context.getString(R.string.blyp_shell_chat_place_preview),
            )
              ?: when (typeName) {
                "image" -> if (body.isEmpty() || body == "IMAGE") "📷" else body
                "voice" -> if (body.isEmpty() || body == "VOICE") "🎤" else body
                else -> body
              }
        }
      BlypShellConversationsStore.touchIncoming(
        context,
        phone,
        convId,
        preview,
        at,
        data.optString("fromName"),
      )
    }
    val messageId = data.optString("messageId").trim().ifEmpty { msg?.optString("id").orEmpty() }
    val first = markOnce(messageId)
    val myId = BlypShellRuntime.accessSubject(context).orEmpty()
    val sender = data.optString("senderUserId").trim().ifEmpty { msg?.optString("senderUserId").orEmpty() }
    val own = myId.isNotEmpty() && sender == myId
    val viewing = PaymentAnnouncePrefs.getActiveConversation(context) == convId
    if (viewing) {
      BlypShellChatUnread.clear(context, convId)
    } else if (!own && first) {
      BlypShellChatUnread.bump(context, convId)
      BlypShellBadgeNativeSync.bumpMessagesUnread(context)
    }
    main.post {
      for (fn in threadListeners) {
        runCatching { fn(convId) }
      }
      for (fn in listListeners) {
        runCatching { fn() }
      }
    }
    val reactionSync = msg?.optString("body")?.let { BlypShellReactionCodec.isSyncBody(it) } == true
    return first && !viewing && !own && !reactionSync
  }

  private fun markOnce(messageId: String): Boolean {
    val id = messageId.trim()
    if (id.isEmpty()) return true
    synchronized(seen) {
      if (!seen.add(id)) return false
      if (seen.size > 60) seen.remove(seen.first())
      return true
    }
  }

  private fun messageFromWsFields(data: JSONObject): JSONObject? {
    val messageId = data.optString("messageId").trim()
    if (messageId.isEmpty()) return null
    val type = data.optString("messageType", "text").trim().ifEmpty { "text" }
    val out =
      JSONObject()
        .put("id", messageId)
        .put("conversationId", data.optString("conversationId"))
        .put("type", type)
        .put("body", data.optString("body").ifEmpty { null })
        .put("senderUserId", data.optString("senderUserId"))
        .put(
          "createdAt",
          data.optString("createdAt").trim().ifEmpty {
            java.time.Instant.now().toString()
          },
        )
    val clientId = data.optString("clientId").trim()
    if (clientId.isNotEmpty()) out.put("clientId", clientId)
    val voiceKey = data.optString("voiceKey").trim()
    if (type == "voice" && voiceKey.isNotEmpty()) {
      out.put(
        "voice",
        JSONObject().put("key", voiceKey).put("durationMs", data.optInt("durationMs", 0)),
      )
    }
    return out
  }
}