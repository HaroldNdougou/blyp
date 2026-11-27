package com.haroldndougou.blyp.shell

import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object BlypShellChatSend {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(25, TimeUnit.SECONDS)
      .build()

  fun sendTextAsync(
    context: android.content.Context,
    phone: String,
    conversationId: String,
    body: String,
    clientId: String,
    replyToMessageId: String? = null,
    onFinished: (ok: Boolean, serverMessage: JSONObject?, networkFailed: Boolean) -> Unit,
  ) {
    val trimmed = body.trim()
    if (trimmed.isEmpty()) {
      Handler(Looper.getMainLooper()).post { onFinished(false, null, false) }
      return
    }
    Thread {
        var ok = false
        var networkFailed = false
        var msg: JSONObject? = null
        try {
          val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: run {
            Handler(Looper.getMainLooper()).post { onFinished(false, null, false) }
            return@Thread
          }
          val cid = conversationId.trim()
          val url =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
              "/messages"
          val payload =
            JSONObject()
              .put("type", "text")
              .put("body", trimmed)
              .put("clientId", clientId)
              .apply {
                val reply = replyToMessageId?.trim().orEmpty()
                if (reply.isNotEmpty()) put("replyToMessageId", reply)
              }
          val req =
            Request.Builder()
              .url(url)
              .header("Authorization", "Bearer ${runtime.accessToken}")
              .header("Accept", "application/json")
              .post(
                payload.toString().toRequestBody("application/json".toMediaType()),
              )
              .build()
          http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
              BlypShellSessionReplaced.maybeKickFromHttp(context, resp.code, text)
            } else if (text.isNotBlank()) {
              val root = JSONObject(text)
              val m = root.optJSONObject("message")
              if (m != null) {
                val id = m.optString("id").trim().ifEmpty { clientId }
                msg = JSONObject(m.toString()).put("id", id)
                ok = true
              }
            }
          }
        } catch (e: Exception) {
          ok = false
          networkFailed = e is java.io.IOException || !BlypShellNetwork.isOnline(context)
        }
        Handler(Looper.getMainLooper()).post { onFinished(ok, msg, networkFailed) }
      }
      .start()
  }
}