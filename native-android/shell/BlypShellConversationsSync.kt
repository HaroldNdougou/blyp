package com.haroldndougou.blyp.shell

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** GET `/conversations` — écrit SQLite (aligné `listConversations`). */
object BlypShellConversationsSync {
  private const val TAG = "BlypConvSync"

  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()

  fun scheduleAfterListPaint(
    context: android.content.Context,
    phone: String,
    onFinished: ((syncOk: Boolean) -> Unit)? = null,
  ) {
    if (!BlypShellConversationsListGate.shouldPull()) {
      onFinished?.let { Handler(Looper.getMainLooper()).post { it(true) } }
      return
    }
    runAsync(context, phone, markGate = true, onFinished)
  }

  fun syncAfterUserPull(
    context: android.content.Context,
    phone: String,
    onFinished: ((syncOk: Boolean) -> Unit)? = null,
  ) {
    runAsync(context, phone, markGate = true, onFinished)
  }

  private fun runAsync(
    context: android.content.Context,
    phone: String,
    markGate: Boolean,
    onFinished: ((syncOk: Boolean) -> Unit)?,
  ) {
    Thread {
        var ok = false
        try {
          ok = runSync(context.applicationContext, phone)
          if (ok && markGate) BlypShellConversationsListGate.markPulled()
        } catch (e: Exception) {
          if (Log.isLoggable(TAG, Log.DEBUG)) Log.d(TAG, "sync skip", e)
        } finally {
          onFinished?.let { fn ->
            Handler(Looper.getMainLooper()).post { fn(ok) }
          }
        }
      }
      .start()
  }

  private fun runSync(context: android.content.Context, phoneRaw: String): Boolean {
    val phone = phoneRaw.trim()
    if (phone.isEmpty()) return false
    val runtime = BlypShellRuntime.readFresh(context) ?: return false
    val url = "${runtime.apiBaseUrl.trimEnd('/')}/conversations"
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
      val items = root.optJSONArray("items") ?: JSONArray()
      return BlypShellConversationsStore.replaceAll(context, phone, items)
    }
  }
}