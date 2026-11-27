package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object BlypShellConversationsOpen {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(12, TimeUnit.SECONDS)
      .build()

  fun toE164(raw: String): String? {
    val nine = BlypShellAuthClient.normalizePhoneDigits(raw) ?: return null
    return "+237$nine"
  }

  fun openByPhoneAsync(
    context: Context,
    phoneRaw: String,
    onFinished: (ok: Boolean, conversationId: String?, errorMessage: String?) -> Unit,
  ) {
    val e164 = toE164(phoneRaw) ?: run {
      Handler(Looper.getMainLooper()).post {
        onFinished(false, null, null)
      }
      return
    }
    val owner = BlypShellSession.phone(context)?.trim().orEmpty()
    if (owner.isEmpty()) {
      Handler(Looper.getMainLooper()).post { onFinished(false, null, null) }
      return
    }
    val app = context.applicationContext
    val cached = BlypShellConversationsStore.findIdByPeerPhone(app, owner, phoneRaw)
    if (!cached.isNullOrEmpty()) {
      Handler(Looper.getMainLooper()).post {
        onFinished(true, cached, null)
      }
      Thread {
        refreshFromNetwork(app, owner, e164)
      }.start()
      return
    }
    Thread {
        var err: String? = null
        val net = refreshFromNetwork(app, owner, e164)
        if (!net.first) {
          err = net.second
        }
        val convId =
          net.third
            ?: BlypShellConversationsStore.findIdByPeerPhone(app, owner, phoneRaw)
        Handler(Looper.getMainLooper()).post {
          onFinished(convId != null, convId, err)
        }
      }
      .start()
  }

  /** ok, errorMessage, conversationId */
  private fun refreshFromNetwork(
    app: android.content.Context,
    owner: String,
    e164: String,
  ): Triple<Boolean, String?, String?> {
    var convId: String? = null
    var err: String? = null
    try {
      val runtime = BlypShellRuntime.readFresh(app) ?: throw IllegalStateException("runtime")
      val url = "${runtime.apiBaseUrl.trimEnd('/')}/conversations"
      val payload = JSONObject().put("phone", e164)
      val req =
        Request.Builder()
          .url(url)
          .header("Authorization", "Bearer ${runtime.accessToken}")
          .header("Accept", "application/json")
          .post(payload.toString().toRequestBody("application/json".toMediaType()))
          .build()
      http.newCall(req).execute().use { resp ->
        val body = resp.body?.string().orEmpty()
        if (!resp.isSuccessful) {
          BlypShellSessionReplaced.maybeKickFromHttp(app, resp.code, body)
          err =
            try {
              JSONObject(body).optString("message").trim().ifEmpty { null }
            } catch (_: Exception) {
              null
            }
          return Triple(false, err, null)
        }
        val root = JSONObject(body)
        val conv = root.optJSONObject("conversation") ?: throw IllegalStateException("conv")
        convId = conv.optString("id").trim().ifEmpty { null }
        if (convId != null) {
          val merged = conv
          merged.put("shellKeepInList", true)
          BlypShellConversationsStore.upsertOne(app, owner, merged)
          return Triple(true, null, convId)
        }
      }
    } catch (_: Exception) {
      return Triple(false, err, null)
    }
    return Triple(false, err, null)
  }
}