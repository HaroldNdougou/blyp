package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import android.net.Uri
import android.util.Log
import com.haroldndougou.blyp.BuildConfig
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Accusé « reçu » app tuée — après la notif, jamais sur le chemin UI.
 * Token d’accès seulement, jamais le PIN.
 */
object ConversationReceiptAck {
  fun markDelivered(context: Context, conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val app = context.applicationContext
    thread(name = "blyp-receipt-ack", isDaemon = true) {
      try {
        postDelivered(app, id)
      } catch (e: Exception) {
        if (BuildConfig.DEBUG) {
          Log.d(TAG, "delivered skip ${e.message}")
        }
      }
    }
  }

  private fun postDelivered(context: Context, conversationId: String) {
    val base = PaymentAnnouncePrefs.getApiBase(context)
    val token = PaymentAnnouncePrefs.getAccessToken(context)
    if (base.isEmpty() || token.isEmpty()) return

    val url =
      URL("$base/conversations/${Uri.encode(conversationId)}/messages")
    val conn = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 8_000
      readTimeout = 8_000
      doOutput = true
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Accept", "application/json")
    }
    try {
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
        it.write("""{"type":"delivered"}""")
      }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      stream?.use { it.readBytes() }
      if (code !in 200..299 && BuildConfig.DEBUG) {
        Log.d(TAG, "delivered http $code")
      }
    } finally {
      conn.disconnect()
    }
  }

  private const val TAG = "BlypReceiptAck"
}
