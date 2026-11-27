package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.haroldndougou.blyp.realtime.BlypWsFrame
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * WebSocket wallet pour la coque — fonctionne sans monter React (cold start natif).
 * Ne remplace pas le hub JS quand l’îlot Messages est ouvert (WS coque en pause).
 */
object BlypShellWalletRealtime {
  private const val TAG = "BlypShellWalletRt"
  private const val PING_MS = 25_000L
  private const val RECONNECT_MS = 3_200L

  private val main = Handler(Looper.getMainLooper())
  private val client =
    OkHttpClient.Builder()
      .pingInterval(0, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .build()

  @Volatile private var webSocket: WebSocket? = null
  @Volatile private var running = false
  @Volatile private var appContext: Context? = null

  private val pingRunnable =
    object : Runnable {
      override fun run() {
        if (!running) return
        try {
          val frame = BlypWsFrame.encodePing()
          webSocket?.send(ByteString.of(*frame))
        } catch (_: Exception) {
          /* ignore */
        }
        main.postDelayed(this, PING_MS)
      }
    }

  private val reconnectRunnable =
    Runnable {
      val ctx = appContext ?: return@Runnable
      if (running) connectInternal(ctx.applicationContext)
    }

  fun start(context: Context) {
    val app = context.applicationContext
    appContext = app
    if (running) return
    running = true
    connectInternal(app)
    main.removeCallbacks(pingRunnable)
    main.postDelayed(pingRunnable, PING_MS)
  }

  fun sendText(text: String) {
    try {
      webSocket?.send(text)
    } catch (_: Exception) {
    }
  }

  fun sendFrame(bytes: ByteArray) {
    try {
      webSocket?.send(ByteString.of(*bytes))
    } catch (_: Exception) {
      /* ignore */
    }
  }

  fun stop() {
    running = false
    main.removeCallbacks(pingRunnable)
    main.removeCallbacks(reconnectRunnable)
    try {
      webSocket?.close(1000, "shell_stop")
    } catch (_: Exception) {
      /* ignore */
    }
    webSocket = null
  }

  private fun connectInternal(context: Context) {
    val runtime = BlypShellRuntime.readFresh(context)
    val wsBase = BlypShellAuthMirror.wsBaseUrl(context).trim()
    if (runtime == null || wsBase.isEmpty()) {
      scheduleReconnect()
      return
    }
    try {
      webSocket?.close(1000, "reconnect")
    } catch (_: Exception) {
      /* ignore */
    }
    val sep = if (wsBase.contains("?")) "&" else "?"
    val url = "$wsBase${sep}token=${runtime.accessToken}"
    val req = Request.Builder().url(url).build()
    webSocket =
      client.newWebSocket(
        req,
        object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) {
            BlypShellPush.pushCheckFrame(context)?.let { webSocket.send(it) }
          }

          override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            val decoded =
              BlypWsFrame.decode(bytes.toByteArray())
                ?: runCatching { JSONObject(bytes.utf8()) }.getOrNull()
                ?: return
            dispatch(context, decoded)
          }

          override fun onMessage(webSocket: WebSocket, text: String) {
            runCatching {
              dispatch(context, JSONObject(text))
            }
          }

          override fun onFailure(
            webSocket: WebSocket,
            t: Throwable,
            response: Response?,
          ) {
            if (Log.isLoggable(TAG, Log.DEBUG)) {
              Log.d(TAG, "ws failure", t)
            }
            scheduleReconnect()
          }

          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (running) scheduleReconnect()
          }
        },
      )
  }

  private fun dispatch(context: Context, data: JSONObject) {
    if (data.optString("type") == "pong") return
    if (data.optString("type") == "push_register_needed") {
      BlypShellPush.onRegisterNeeded(context)
      return
    }
    val type = data.optString("type", "")
    if (type == "message_received") {
      BlypShellChatRealtime.dispatch(context.applicationContext, data)
      return
    }
    if (type == "conversation_receipt" || type == "conversation_presence") {
      BlypShellChatReceipts.ingest(context.applicationContext, data)
      return
    }
    if (type == "conversation_typing") {
      BlypShellChatTyping.ingest(data)
      return
    }
    BlypShellWalletIngest.ingestPayload(context.applicationContext, data)
    if (type == "money_updated") {
      BlypShellChatMessagesStore.applyMoneySignal(context.applicationContext, data)
      BlypShellBridge.emitRealtimePayload(data)
    }
  }

  private fun scheduleReconnect() {
    if (!running) return
    main.removeCallbacks(reconnectRunnable)
    main.postDelayed(reconnectRunnable, RECONNECT_MS)
  }
}
