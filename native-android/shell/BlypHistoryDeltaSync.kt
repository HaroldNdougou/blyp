package com.haroldndougou.blyp.shell

import android.util.Log
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Delta `/transactions` après paint Historique natif — écrit SQLite local. */
object BlypHistoryDeltaSync {
  private const val TAG = "BlypHistoryDeltaSync"
  private const val MIN_INTERVAL_MS = 45_000L
  @Volatile private var lastRunMs = 0L
  @Volatile private var lastScope = ""

  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()

  fun scheduleAfterHistoryPaint(
    context: android.content.Context,
    phone: String,
    onFinished: ((syncOk: Boolean) -> Unit)? = null,
  ) {
    val now = System.currentTimeMillis()
    val scope = BlypTransactionStore.scopeKey(context, phone)
    if (scope == lastScope && now - lastRunMs < MIN_INTERVAL_MS) {
      onFinished?.let { Handler(Looper.getMainLooper()).post { it(true) } }
      return
    }
    lastRunMs = now
    lastScope = scope
    runSyncAsync(context, phone, onFinished)
  }

  /** Pull-to-refresh — ignore le throttle automatique. */
  fun syncAfterUserPull(
    context: android.content.Context,
    phone: String,
    onFinished: ((syncOk: Boolean) -> Unit)? = null,
  ) {
    lastRunMs = System.currentTimeMillis()
    runSyncAsync(context, phone, onFinished)
  }

  private fun runSyncAsync(
    context: android.content.Context,
    phone: String,
    onFinished: ((syncOk: Boolean) -> Unit)?,
  ) {
    Thread {
        var ok = false
        try {
          ok = runSync(context.applicationContext, phone)
        } catch (e: Exception) {
          if (Log.isLoggable(TAG, Log.DEBUG)) Log.d(TAG, "sync skip", e)
          ok = false
        } finally {
          onFinished?.let { fn ->
            Handler(Looper.getMainLooper()).post { fn(ok) }
          }
        }
      }
      .start()
  }

  private fun runSync(context: android.content.Context, phoneRaw: String): Boolean {
    val phone = BlypTransactionStore.scopeKey(context, phoneRaw)
    val runtime = BlypShellRuntime.readFresh(context) ?: return false
    val db = BlypTransactionStore.openReadWriteDb(context) ?: return false
    db.use { database ->
      val cursor = BlypTransactionStore.readSyncCursor(database, phone)
      val url =
        buildString {
          append(runtime.apiBaseUrl)
          append("/transactions")
          if (!cursor.isNullOrBlank()) {
            append("?since=")
            append(java.net.URLEncoder.encode(cursor, Charsets.UTF_8.name()))
          }
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
          BlypShellSessionReplaced.maybeKickFromHttp(
            context,
            resp.code,
            bodyText,
          )
          return false
        }
        if (bodyText.isBlank()) return true
        val root = JSONObject(bodyText)
        val items = root.optJSONArray("items") ?: JSONArray()
        if (items.length() == 0) return true
        database.beginTransaction()
        try {
          for (i in 0 until items.length()) {
            val o = items.optJSONObject(i) ?: continue
            BlypTransactionStore.upsertTransactionFromJson(database, phone, o)
          }
          val nextCursor = root.optString("cursor", "").trim()
          if (nextCursor.isNotEmpty()) {
            BlypTransactionStore.writeSyncCursor(database, phone, nextCursor)
          }
          database.setTransactionSuccessful()
        } finally {
          database.endTransaction()
        }
        return true
      }
    }
  }
}
