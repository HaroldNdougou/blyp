package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

/** Accusé de lecture : l’autre a ouvert la discussion. */
object BlypShellChatReceipts {
  private const val ONLINE_MS = 45_000L
  private val listeners = CopyOnWriteArraySet<(String) -> Unit>()
  private val presenceAtMs = java.util.concurrent.ConcurrentHashMap<String, Long>()
  private val main = Handler(Looper.getMainLooper())
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()

  fun subscribe(listener: (String) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun peerReadAt(context: Context, phoneRaw: String, conversationId: String): String? {
    val phone = phoneRaw.trim()
    val cid = conversationId.trim()
    if (phone.isEmpty() || cid.isEmpty()) return null
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return null
    return try {
      db.rawQuery(
          "SELECT peerLastReadAt FROM chat_receipts WHERE phone = ? AND conversationId = ? LIMIT 1",
          arrayOf(phone, cid),
        )
        .use { c ->
          if (!c.moveToFirst()) null else c.getString(0)?.trim()?.ifEmpty { null }
        }
    } catch (_: Exception) {
      null
    } finally {
      db.close()
    }
  }

  fun notePeerRead(context: Context, phoneRaw: String, conversationId: String, at: String?) {
    val phone = phoneRaw.trim()
    val cid = conversationId.trim()
    val next = at?.trim().orEmpty()
    if (phone.isEmpty() || cid.isEmpty() || next.isEmpty()) return
    val prev = peerReadAt(context, phone, cid)
    if (prev != null && !isAfter(next, prev)) return
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return
    try {
      db.execSQL(
        "INSERT OR REPLACE INTO chat_receipts (phone, conversationId, peerLastReadAt, peerLastDeliveredAt) VALUES (?, ?, ?, ?)",
        arrayOf(phone, cid, next, null),
      )
    } catch (_: Exception) {
      return
    } finally {
      db.close()
    }
    main.post {
      for (fn in listeners) {
        runCatching { fn(cid) }
      }
    }
  }

  fun notePeerPresence(conversationId: String, at: String?) {
    val cid = conversationId.trim()
    val iso = at?.trim().orEmpty()
    if (cid.isEmpty() || iso.isEmpty()) return
    val ms =
      try {
        Instant.parse(iso).toEpochMilli()
      } catch (_: Exception) {
        return
      }
    val prev = presenceAtMs[cid] ?: 0L
    if (ms <= prev) return
    presenceAtMs[cid] = ms
    main.post {
      for (fn in listeners) {
        runCatching { fn(cid) }
      }
    }
  }

  fun peerPresenceMs(conversationId: String): Long = presenceAtMs[conversationId.trim()] ?: 0L

  fun peerOnline(conversationId: String): Boolean {
    val ms = presenceAtMs[conversationId.trim()] ?: return false
    return System.currentTimeMillis() - ms < ONLINE_MS
  }

  fun ingest(context: Context, data: JSONObject) {
    val type = data.optString("type")
    val kind = data.optString("kind")
    val cid = data.optString("conversationId").trim()
    val at = data.optString("at").trim().ifEmpty { data.optString("presenceAt").trim() }
    val read =
      (type == "conversation_receipt" && kind == "read") ||
        (type == "conversation_presence" && kind == "read")
    if (type == "conversation_presence" || read) notePeerPresence(cid, at)
    if (!read) return
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    notePeerRead(context, phone, cid, at)
  }

  fun markReadAsync(context: Context, conversationId: String) {
    postSignal(context, conversationId, "read")
  }

  fun markPresenceAsync(context: Context, conversationId: String) {
    postSignal(context, conversationId, "presence")
  }

  private fun postSignal(context: Context, conversationId: String, type: String) {
    val app = context.applicationContext
    val cid = conversationId.trim()
    if (cid.isEmpty()) return
    Thread {
        try {
          val runtime = BlypShellRuntime.readFresh(app) ?: return@Thread
          val url =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
              "/messages"
          val req =
            Request.Builder()
              .url(url)
              .header("Authorization", "Bearer ${runtime.accessToken}")
              .header("Accept", "application/json")
              .post("""{"type":"$type"}""".toRequestBody("application/json".toMediaType()))
              .build()
          http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
              BlypShellSessionReplaced.maybeKickFromHttp(app, resp.code, text)
            }
          }
        } catch (_: Exception) {
          /* le fil reste lisible */
        }
      }
      .start()
  }

  fun seen(messageAt: String, cursor: String?): Boolean {
    val at = messageAt.trim()
    val cut = cursor?.trim().orEmpty()
    if (at.isEmpty() || cut.isEmpty()) return false
    return !isAfter(at, cut)
  }

  private fun isAfter(a: String, b: String): Boolean {
    return try {
      Instant.parse(a).isAfter(Instant.parse(b))
    } catch (_: Exception) {
      a > b
    }
  }
}
