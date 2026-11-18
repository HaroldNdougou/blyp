package com.haroldndougou.blyp.realtime

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit

class BlypRealtimeEngine(
  private val reactContext: ReactApplicationContext,
) {
  private val client =
    OkHttpClient.Builder()
      .pingInterval(0, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .build()

  @Volatile private var webSocket: WebSocket? = null

  fun start(wsBaseUrl: String, accessToken: String) {
    stop()
    val base = wsBaseUrl.trim()
    val sep = if (base.contains("?")) "&" else "?"
    val url = "$base${sep}token=${accessToken.trim()}"
    val req = Request.Builder().url(url).build()
    webSocket =
      client.newWebSocket(
        req,
        object : WebSocketListener() {
          override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            val decoded = BlypWsFrame.decode(bytes.toByteArray()) ?: return
            emitPayload(decoded.toString())
          }

          override fun onMessage(webSocket: WebSocket, text: String) {
            try {
              emitPayload(text)
            } catch (_: Exception) {
              /* ignore legacy */
            }
          }

          override fun onFailure(
            webSocket: WebSocket,
            t: Throwable,
            response: Response?,
          ) {
            /* reconnect géré côté JS si besoin */
          }
        },
      )
  }

  fun stop() {
    try {
      webSocket?.close(1000, "stop")
    } catch (_: Exception) {
      /* ignore */
    }
    webSocket = null
  }

  fun sendActionJson(json: String) {
    val frame = BlypWsFrame.encodeClientAction(json)
    webSocket?.send(ByteString.of(*frame))
  }

  fun sendFrameBase64(b64: String) {
    val bytes = Base64.decode(b64, Base64.DEFAULT)
    webSocket?.send(ByteString.of(*bytes))
  }

  private fun emitPayload(json: String) {
    val map = Arguments.createMap()
    map.putString("json", json)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("BlypRealtimePayload", map)
  }
}
