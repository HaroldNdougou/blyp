package com.haroldndougou.blyp.shell

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Textes encore locaux : partent dès que le réseau revient. */
object BlypShellChatOutbox {
  private val main = Handler(Looper.getMainLooper())
  private val inFlight = HashSet<String>()
  private val waiting = HashSet<String>()
  @Volatile private var listening = false
  private val flushing = AtomicBoolean(false)

  fun pendingLabel(clientId: String?): Int {
    val id = clientId?.trim().orEmpty()
    synchronized(inFlight) {
      if (id.isNotEmpty() && id in waiting) return com.haroldndougou.blyp.R.string.blyp_shell_chat_pending
    }
    return com.haroldndougou.blyp.R.string.blyp_shell_chat_sending
  }

  fun install(context: Context) {
    if (listening) return
    val app = context.applicationContext
    val cm =
      app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
    try {
      val request =
        NetworkRequest.Builder()
          .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .build()
      cm.registerNetworkCallback(
        request,
        object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            main.post { flush(app) }
          }

          override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
              main.post { flush(app) }
            }
          }
        },
      )
      listening = true
    } catch (_: Exception) {
      return
    }
    Thread { flushNow(app) }.start()
  }

  fun send(
    context: Context,
    phone: String,
    conversationId: String,
    body: String,
    clientId: String,
    replyToMessageId: String?,
    onFinished: (Boolean) -> Unit,
  ) {
    install(context)
    dispatch(context.applicationContext, phone, conversationId, body, clientId, replyToMessageId) {
        ok ->
      main.post { onFinished(ok) }
    }
  }

  fun claimSend(clientId: String): Boolean {
    val id = clientId.trim()
    if (id.isEmpty()) return false
    synchronized(inFlight) {
      if (id in inFlight) return false
      waiting.remove(id)
      inFlight.add(id)
      return true
    }
  }

  fun finishSend(clientId: String, ok: Boolean) {
    val id = clientId.trim()
    if (id.isEmpty()) return
    synchronized(inFlight) {
      inFlight.remove(id)
      if (ok) waiting.remove(id) else waiting.add(id)
    }
  }

  fun noteWaiting(clientId: String) {
    val id = clientId.trim()
    if (id.isEmpty()) return
    synchronized(inFlight) { waiting.add(id) }
  }

  fun clearWaiting(clientId: String) {
    val id = clientId.trim()
    if (id.isEmpty()) return
    synchronized(inFlight) { waiting.remove(id) }
  }

  fun flush(context: Context) {
    val app = context.applicationContext
    Thread { flushNow(app) }.start()
  }

  private fun flushNow(context: Context) {
    if (!flushing.compareAndSet(false, true)) return
    try {
      flushNowLocked(context)
    } finally {
      flushing.set(false)
    }
  }

  private fun flushNowLocked(context: Context) {
    if (!BlypShellNetwork.isOnline(context)) return
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return
    val app = context.applicationContext
    val convs = LinkedHashSet<String>()
    for (row in BlypShellChatMessagesStore.listPendingTexts(app, phone)) {
      row.optString("conversationId").trim().takeIf { it.isNotEmpty() }?.let { convs.add(it) }
    }
    for (row in BlypShellChatMessagesStore.listPendingMedia(app, phone)) {
      row.optString("conversationId").trim().takeIf { it.isNotEmpty() }?.let { convs.add(it) }
    }
    for (cid in convs) {
      BlypShellChatThreadSync.pullBlocking(app, phone, cid)
    }
    for (row in BlypShellChatMessagesStore.listPendingTexts(app, phone)) {
      val cid = row.optString("conversationId").trim()
      val clientId = row.optString("clientId").trim()
      val body = row.optString("body")
      val reply = row.optString("replyToMessageId").trim().ifEmpty { null }
      dispatch(app, phone, cid, body, clientId, reply, null)
    }
    for (row in BlypShellChatMessagesStore.listPendingMedia(app, phone)) {
      retryMedia(app, phone, row)
    }
  }

  private fun retryMedia(context: Context, phone: String, row: JSONObject) {
    val clientId = row.optString("clientId").trim()
    val cid = row.optString("conversationId").trim()
    val type = row.optString("type")
    if (clientId.isEmpty() || cid.isEmpty()) return
    if (type == "money") {
      BlypShellChatMessagesStore.dropClientMessage(context, phone, cid, clientId)
      BlypShellChatRealtime.poke(cid)
      return
    }
    synchronized(inFlight) {
      if (clientId in inFlight) return
      waiting.remove(clientId)
      inFlight.add(clientId)
    }
    BlypShellChatRealtime.poke(cid)
    val reply = row.optString("replyToMessageId").trim().ifEmpty { null }
    val done: (Boolean, JSONObject?) -> Unit = { ok, server ->
      synchronized(inFlight) {
        inFlight.remove(clientId)
        if (ok && server != null) waiting.remove(clientId) else waiting.add(clientId)
      }
      if (ok && server != null) {
        BlypShellChatMessagesStore.upsertMessages(context, phone, cid, listOf(server))
      }
      BlypShellChatRealtime.poke(cid)
    }
    when (type) {
      "image" -> {
        val img = row.optJSONObject("image")
        val path = img?.optString("localPath")?.trim().orEmpty()
        val file = File(path)
        if (img == null || !file.isFile) {
          synchronized(inFlight) {
            inFlight.remove(clientId)
            waiting.add(clientId)
          }
          BlypShellChatRealtime.poke(cid)
          return
        }
        BlypShellChatMediaSend.sendImageAsync(
          context,
          cid,
          file,
          img.optInt("width"),
          img.optInt("height"),
          clientId,
          row.optString("body").trim().ifEmpty { null },
          reply,
          done,
        )
      }
      "voice" -> {
        val voice = row.optJSONObject("voice")
        val path = voice?.optString("localPath")?.trim().orEmpty()
        val file = File(path)
        if (voice == null || !file.isFile) {
          synchronized(inFlight) { inFlight.remove(clientId) }
          return
        }
        BlypShellChatMediaSend.sendVoiceAsync(
          context,
          cid,
          file,
          voice.optInt("durationMs"),
          clientId,
          reply,
          done,
        )
      }
      "document" -> {
        val doc = row.optJSONObject("document")
        val path = doc?.optString("localPath")?.trim().orEmpty()
        val file = File(path)
        if (doc == null || !file.isFile) {
          synchronized(inFlight) { inFlight.remove(clientId) }
          return
        }
        BlypShellChatMediaSend.sendDocumentAsync(
          context,
          cid,
          file,
          doc.optString("fileName").ifEmpty { file.name },
          doc.optLong("sizeBytes", file.length()),
          doc.optString("contentType").ifEmpty { "application/octet-stream" },
          clientId,
          reply,
          done,
        )
      }
      else -> synchronized(inFlight) { inFlight.remove(clientId) }
    }
  }

  private fun dispatch(
    context: Context,
    phone: String,
    conversationId: String,
    body: String,
    clientId: String,
    replyToMessageId: String?,
    onFinished: ((Boolean) -> Unit)?,
  ) {
    val id = clientId.trim()
    val cid = conversationId.trim()
    if (id.isEmpty() || cid.isEmpty() || body.trim().isEmpty()) {
      onFinished?.invoke(false)
      return
    }
    val online = BlypShellNetwork.isOnline(context)
    synchronized(inFlight) {
      if (id in inFlight) {
        onFinished?.invoke(false)
        return
      }
      if (online) {
        waiting.remove(id)
        inFlight.add(id)
      } else {
        waiting.add(id)
      }
    }
    BlypShellChatRealtime.poke(cid)
    if (!online) {
      onFinished?.invoke(false)
      return
    }
    BlypShellChatSend.sendTextAsync(
      context,
      phone,
      cid,
      body,
      id,
      replyToMessageId,
    ) { ok, server, networkFailed ->
      synchronized(inFlight) { inFlight.remove(id) }
      if (ok && server != null) {
        synchronized(inFlight) { waiting.remove(id) }
        BlypShellChatMessagesStore.upsertMessages(context, phone, cid, listOf(server))
      } else if (networkFailed || !BlypShellNetwork.isOnline(context)) {
        synchronized(inFlight) { waiting.add(id) }
      }
      BlypShellChatRealtime.poke(cid)
      onFinished?.invoke(ok && server != null)
    }
  }
}
