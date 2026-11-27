package com.haroldndougou.blyp.shell

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** GET derniers messages du fil. */
object BlypShellChatThreadSync {
  private const val TAG = "BlypChatThreadSync"
  private const val PAGE = 40

  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()

  fun scheduleAfterPaint(
    context: android.content.Context,
    phone: String,
    conversationId: String,
    onFinished: ((syncOk: Boolean) -> Unit)? = null,
  ) {
    val hasCache =
      BlypShellChatMessagesStore.hasCache(context, phone, conversationId)
    if (!BlypShellChatThreadPullGate.shouldPull(conversationId, hasCache)) {
      onFinished?.let { Handler(Looper.getMainLooper()).post { it(true) } }
      return
    }
    runAsync(context, phone, conversationId, onFinished)
  }

  fun pullBlocking(
    context: android.content.Context,
    phone: String,
    conversationId: String,
  ): Boolean =
    try {
      val ok = runSync(context.applicationContext, phone, conversationId)
      if (ok) BlypShellChatThreadPullGate.markPulled(conversationId)
      ok
    } catch (_: Exception) {
      false
    }

  fun pullNow(
    context: android.content.Context,
    phone: String,
    conversationId: String,
    onFinished: ((syncOk: Boolean) -> Unit)? = null,
  ) {
    runAsync(context, phone, conversationId, onFinished)
  }

  private fun runAsync(
    context: android.content.Context,
    phone: String,
    conversationId: String,
    onFinished: ((syncOk: Boolean) -> Unit)?,
  ) {
    Thread {
        var ok = false
        try {
          ok = runSync(context.applicationContext, phone, conversationId)
          if (ok) BlypShellChatThreadPullGate.markPulled(conversationId)
        } catch (e: Exception) {
          if (Log.isLoggable(TAG, Log.DEBUG)) Log.d(TAG, "pull skip", e)
        } finally {
          onFinished?.let { fn ->
            Handler(Looper.getMainLooper()).post { fn(ok) }
          }
        }
      }
      .start()
  }

  private fun runSync(
    context: android.content.Context,
    phoneRaw: String,
    conversationId: String,
  ): Boolean {
    val phone = phoneRaw.trim()
    val cid = conversationId.trim()
    if (phone.isEmpty() || cid.isEmpty()) return false
    val runtime = BlypShellRuntime.readFresh(context) ?: return false
    val url =
      buildString {
        append(runtime.apiBaseUrl.trimEnd('/'))
        append("/conversations/")
        append(java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()))
        append("/messages?limit=")
        append(PAGE)
      }
    val req =
      Request.Builder()
        .url(url)
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .get()
        .build()
    http.newCall(req).execute().use { resp ->
      val bodyText = resp.body?.string().orEmpty()
      if (!resp.isSuccessful) {
        BlypShellSessionReplaced.maybeKickFromHttp(context, resp.code, bodyText)
        return false
      }
      if (bodyText.isBlank()) return true
      val root = JSONObject(bodyText)
      val raw =
        root.optJSONArray("items")
          ?: root.optJSONArray("messages")
          ?: JSONArray()
      val network = ArrayList<JSONObject>()
      for (i in 0 until raw.length()) {
        val o = raw.optJSONObject(i) ?: continue
        val id =
          o.optString("id").trim().ifEmpty {
            o.optString("messageId").trim()
          }
        if (id.isEmpty()) continue
        network.add(JSONObject(o.toString()).put("id", id))
      }
      val readAt = root.optString("peerLastReadAt").trim().ifEmpty { null }
      if (readAt != null) BlypShellChatReceipts.notePeerRead(context, phone, cid, readAt)
      val presenceAt = root.optString("peerLastPresenceAt").trim().ifEmpty { null }
      if (presenceAt != null) BlypShellChatReceipts.notePeerPresence(cid, presenceAt)
      return BlypShellChatMessagesStore.upsertMessages(context, phone, cid, network)
    }
  }

}