package com.haroldndougou.blyp.shell

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Efface une fois les messages de test déjà en base, sur le téléphone et en ligne. */
object BlypShellChatHistoryWipe {
  private const val PREFS = "blyp_shell_chat_wipe"
  private const val KEY_CUTOFF = "cutoff"
  private const val KEY_DONE = "done"
  private val jsonType = "application/json".toMediaType()
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(25, TimeUnit.SECONDS)
      .build()

  fun cutoff(context: Context): String? =
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_CUTOFF, null)
      ?.trim()
      ?.ifEmpty { null }

  fun startOnce(context: Context) {
    val app = context.applicationContext
    val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getBoolean(KEY_DONE, false)) return
    if (prefs.getString(KEY_CUTOFF, null).isNullOrBlank()) {
      prefs.edit().putString(KEY_CUTOFF, java.time.Instant.now().toString()).apply()
    }
    Thread {
        try {
          BlypShellChatMessagesStore.deleteAll(app)
          if (hideOnServer(app)) {
            BlypShellChatMessagesStore.deleteAll(app)
            prefs.edit().putBoolean(KEY_DONE, true).apply()
          }
        } catch (_: Exception) {
          /* réessai au prochain lancement */
        }
      }
      .start()
  }

  private fun hideOnServer(context: Context): Boolean {
    val runtime = BlypShellRuntime.readFresh(context) ?: return false
    val cut = cutoff(context)
    val ids = conversationIds(runtime) ?: return false
    for (id in ids) {
      if (!hideConversation(runtime, id, cut)) return false
    }
    return true
  }

  private fun conversationIds(runtime: BlypShellRuntime.Snapshot): List<String>? {
    val req =
      Request.Builder()
        .url("${runtime.apiBaseUrl.trimEnd('/')}/conversations")
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .get()
        .build()
    http.newCall(req).execute().use { resp ->
      val text = resp.body?.string().orEmpty()
      if (!resp.isSuccessful) return null
      val items = JSONObject(text.ifBlank { "{}" }).optJSONArray("items") ?: return emptyList()
      return buildList {
        for (i in 0 until items.length()) {
          val id = items.optJSONObject(i)?.optString("id")?.trim().orEmpty()
          if (id.isNotEmpty()) add(id)
        }
      }
    }
  }

  private fun hideConversation(
    runtime: BlypShellRuntime.Snapshot,
    conversationId: String,
    cutoff: String?,
  ): Boolean {
    var before: String? = null
    repeat(30) {
      val url =
        buildString {
          append(runtime.apiBaseUrl.trimEnd('/'))
          append("/conversations/")
          append(java.net.URLEncoder.encode(conversationId, Charsets.UTF_8.name()))
          append("/messages?limit=80")
          if (!before.isNullOrEmpty()) {
            append("&before=")
            append(java.net.URLEncoder.encode(before, Charsets.UTF_8.name()))
          }
        }
      val req =
        Request.Builder()
          .url(url)
          .header("Authorization", "Bearer ${runtime.accessToken}")
          .header("Accept", "application/json")
          .get()
          .build()
      var oldest: String? = null
      var hasMore = false
      val ids = ArrayList<String>()
      http.newCall(req).execute().use { resp ->
        val text = resp.body?.string().orEmpty()
        if (!resp.isSuccessful) return false
        val root = JSONObject(text.ifBlank { "{}" })
        hasMore = root.optBoolean("hasMore", false)
        oldest = root.optString("oldestId").trim().ifEmpty { null }
        val items = root.optJSONArray("items")
        if (items != null) {
          for (i in 0 until items.length()) {
            val o = items.optJSONObject(i) ?: continue
            val created = o.optString("createdAt").trim()
            if (cutoff != null && created.isNotEmpty() && created > cutoff) continue
            val id = o.optString("id").trim()
            if (id.isNotEmpty()) ids.add(id)
          }
        }
      }
      for (id in ids) {
        if (!hideOne(runtime, conversationId, id)) return false
      }
      if (!hasMore || oldest.isNullOrEmpty() || oldest == before) return true
      before = oldest
    }
    return true
  }

  private fun hideOne(
    runtime: BlypShellRuntime.Snapshot,
    conversationId: String,
    messageId: String,
  ): Boolean {
    val url =
      runtime.apiBaseUrl.trimEnd('/') +
        "/conversations/" +
        java.net.URLEncoder.encode(conversationId, Charsets.UTF_8.name()) +
        "/messages"
    val body =
      JSONObject()
        .put("type", "delete")
        .put("messageId", messageId)
        .put("scope", "me")
        .toString()
        .toRequestBody(jsonType)
    val req =
      Request.Builder()
        .url(url)
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .post(body)
        .build()
    http.newCall(req).execute().use { resp ->
      return resp.isSuccessful || resp.code == 404
    }
  }
}
