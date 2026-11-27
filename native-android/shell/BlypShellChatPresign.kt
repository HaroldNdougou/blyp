package com.haroldndougou.blyp.shell

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal object BlypShellChatPresign {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(120, TimeUnit.SECONDS)
      .build()

  fun messagesUrl(context: Context, conversationId: String): String? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val cid = conversationId.trim()
    return "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
      java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
      "/messages"
  }

  /** @return ok to delete, and whether server rejected as too late / money settled */
  fun postDelete(
    context: Context,
    conversationId: String,
    messageId: String,
    scope: String,
  ): Pair<Boolean, Boolean> {
    val url = messagesUrl(context, conversationId) ?: return false to false
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return false to false
    val body =
      JSONObject()
        .put("type", "delete")
        .put("messageId", messageId.trim())
        .put("scope", scope)
    val req =
      Request.Builder()
        .url(url)
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .post(body.toString().toRequestBody("application/json".toMediaType()))
        .build()
    return try {
      http.newCall(req).execute().use { resp ->
        val text = resp.body?.string().orEmpty()
        when {
          resp.isSuccessful -> true to false
          text.contains("DELETE_TOO_LATE") -> false to true
          else -> {
            BlypShellSessionReplaced.maybeKickFromHttp(context, resp.code, text)
            false to false
          }
        }
      }
    } catch (_: Exception) {
      false to false
    }
  }

  fun post(context: Context, conversationId: String, body: JSONObject): JSONObject? {
    val url = messagesUrl(context, conversationId) ?: return null
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val req =
      Request.Builder()
        .url(url)
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .post(body.toString().toRequestBody("application/json".toMediaType()))
        .build()
    return try {
      http.newCall(req).execute().use { resp ->
        val text = resp.body?.string().orEmpty()
        if (!resp.isSuccessful) {
          BlypShellSessionReplaced.maybeKickFromHttp(context, resp.code, text)
          return null
        }
        JSONObject(text.ifBlank { "{}" })
      }
    } catch (_: Exception) {
      null
    }
  }

  fun downloadUrl(url: String, dest: java.io.File): Boolean {
    val req = Request.Builder().url(url).get().build()
    return try {
      http.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) return false
        val body = resp.body ?: return false
        dest.parentFile?.mkdirs()
        dest.outputStream().use { out -> body.byteStream().copyTo(out) }
        dest.length() > 0
      }
    } catch (_: Exception) {
      false
    }
  }
}