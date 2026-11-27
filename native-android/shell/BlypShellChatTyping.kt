package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.haroldndougou.blyp.realtime.BlypWsFrame
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

/** « écrit… » : même délai que le chat d’avant (3,5 s sans nouveau signal). */
object BlypShellChatTyping {
  private const val TTL_MS = 3_500L
  private val main = Handler(Looper.getMainLooper())
  private val until = HashMap<String, Long>()
  private val peerLang = HashMap<String, String>()
  private val listeners = CopyOnWriteArraySet<(String) -> Unit>()

  private val http =
    OkHttpClient.Builder()
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(8, TimeUnit.SECONDS)
      .build()

  fun subscribe(listener: (String) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun peerLanguage(conversationId: String): String? {
    val id = conversationId.trim()
    if (id.isEmpty()) return null
    return peerLang[id]
  }

  fun isOn(conversationId: String): Boolean {
    val id = conversationId.trim()
    val end = until[id] ?: return false
    if (end <= SystemClock.elapsedRealtime()) {
      until.remove(id)
      return false
    }
    return true
  }

  fun ingest(data: JSONObject) {
    val id = data.optString("conversationId").trim()
    if (id.isEmpty()) return
    val on = typingOn(data.opt("on"))
    val lang = data.optString("lang").trim().lowercase().substringBefore('-')
    main.post {
      if (lang.length >= 2) peerLang[id] = lang
      if (!on) {
        until.remove(id)
      } else {
        until[id] = SystemClock.elapsedRealtime() + TTL_MS
        main.postDelayed({ expire(id) }, TTL_MS + 40L)
      }
      for (fn in listeners) runCatching { fn(id) }
    }
  }

  fun send(context: Context, conversationId: String, on: Boolean) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val lang =
      java.util.Locale.getDefault().language.trim().lowercase().substringBefore('-').ifEmpty { "en" }
    val json =
      JSONObject()
        .put("action", "typing")
        .put("conversationId", id)
        .put("on", on)
        .put("lang", lang)
        .toString()
    BlypShellWalletRealtime.sendText(json)
    BlypShellWalletRealtime.sendFrame(BlypWsFrame.encodeClientAction(json))
    Thread {
        try {
          val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return@Thread
          val url =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(id, Charsets.UTF_8.name()) +
              "/messages"
          val req =
            Request.Builder()
              .url(url)
              .header("Authorization", "Bearer ${runtime.accessToken}")
              .header("Accept", "application/json")
              .post(
                JSONObject()
                  .put("type", "typing")
                  .put("on", on)
                  .put("lang", lang)
                  .toString()
                  .toRequestBody(
                  "application/json".toMediaType(),
                ),
              )
              .build()
          http.newCall(req).execute().close()
        } catch (_: Exception) {
        }
      }
      .start()
  }

  private fun expire(id: String) {
    val end = until[id] ?: return
    if (end > SystemClock.elapsedRealtime()) return
    until.remove(id)
    for (fn in listeners) runCatching { fn(id) }
  }

  private fun typingOn(raw: Any?): Boolean {
    return when (raw) {
      is Boolean -> raw
      is Number -> raw.toInt() != 0
      else -> {
        val s = raw?.toString()?.trim()?.lowercase().orEmpty()
        s.isNotEmpty() && s != "0" && s != "false"
      }
    }
  }
}
