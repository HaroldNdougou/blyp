package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Partage position en direct : ticks locaux + messages sync pliés. */
object BlypShellLivePlace {
  private val main = Handler(Looper.getMainLooper())
  private var sessionId: String? = null
  private var conversationId: String? = null
  private var expiresAtMs = 0L
  private var listener: LocationListener? = null
  private var appCtx: Context? = null
  private val sending = AtomicBoolean(false)
  private var lastSentAt = 0L
  private val tick =
    object : Runnable {
      override fun run() {
        val ctx = appCtx ?: return
        val sid = sessionId ?: return
        val cid = conversationId ?: return
        if (System.currentTimeMillis() >= expiresAtMs) {
          stop(ctx, sid, cid, notifyPeer = true)
          return
        }
        BlypShellUiRefresh.notifyChatChanged(cid)
        main.postDelayed(this, 15_000L)
      }
    }

  fun activeSessionId(): String? = sessionId

  fun isActive(conversationId: String, sessionId: String): Boolean =
    this.conversationId == conversationId && this.sessionId == sessionId &&
      System.currentTimeMillis() < expiresAtMs

  fun start(
    context: Context,
    conversationId: String,
    sessionId: String,
    expiresAtMs: Long,
  ) {
    stopLocalOnly()
    this.appCtx = context.applicationContext
    this.conversationId = conversationId
    this.sessionId = sessionId
    this.expiresAtMs = expiresAtMs
    attachGps(context.applicationContext)
    main.removeCallbacks(tick)
    main.post(tick)
  }

  fun stop(
    context: Context,
    sessionId: String,
    conversationId: String,
    notifyPeer: Boolean,
  ) {
    if (this.sessionId != null && this.sessionId != sessionId) return
    stopLocalOnly()
    if (!notifyPeer) return
    val phone = BlypShellSession.phone(context).orEmpty()
    if (phone.isEmpty()) return
    val clientId = UUID.randomUUID().toString()
    val body = BlypShellPlaceCodec.encodeStop(sessionId)
    val myId = BlypShellSession.accountId(context).orEmpty()
    if (myId.isNotEmpty()) {
      val optimistic =
        BlypShellChatMessagesStore.optimisticText(conversationId, myId, body, clientId)
      val local = BlypShellChatMessagesStore.loadRawObjects(context, phone, conversationId)
      val merged = BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(optimistic))
      BlypShellChatMessagesStore.saveMerged(context, phone, conversationId, merged)
      BlypShellUiRefresh.notifyChatChanged(conversationId)
    }
    BlypShellChatSend.sendTextAsync(context, phone, conversationId, body, clientId) { ok, msg, _ ->
      if (!ok || msg == null) return@sendTextAsync
      val local = BlypShellChatMessagesStore.loadRawObjects(context, phone, conversationId)
      val merged = BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(msg))
      BlypShellChatMessagesStore.saveMerged(context, phone, conversationId, merged)
      BlypShellUiRefresh.notifyChatChanged(conversationId)
    }
  }

  private fun stopLocalOnly() {
    main.removeCallbacks(tick)
    val ctx = appCtx
    val lm = ctx?.getSystemService(LocationManager::class.java)
    val lis = listener
    if (ctx != null && lm != null && lis != null) {
      try {
        lm.removeUpdates(lis)
      } catch (_: Exception) {
      }
    }
    listener = null
    sessionId = null
    conversationId = null
    expiresAtMs = 0L
    appCtx = null
  }

  private fun attachGps(context: Context) {
    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    val lm = context.getSystemService(LocationManager::class.java) ?: return
    val lis =
      object : LocationListener {
        override fun onLocationChanged(location: Location) {
          maybeSendUpdate(context, location)
        }

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

        override fun onProviderEnabled(provider: String) {}

        override fun onProviderDisabled(provider: String) {}
      }
    listener = lis
    try {
      if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 20_000L, 25f, lis, Looper.getMainLooper())
      }
      if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
        lm.requestLocationUpdates(
          LocationManager.NETWORK_PROVIDER,
          20_000L,
          40f,
          lis,
          Looper.getMainLooper(),
        )
      }
    } catch (_: SecurityException) {
    } catch (_: Exception) {
    }
  }

  private fun maybeSendUpdate(context: Context, location: Location) {
    val sid = sessionId ?: return
    val cid = conversationId ?: return
    if (System.currentTimeMillis() >= expiresAtMs) {
      stop(context, sid, cid, notifyPeer = true)
      return
    }
    val now = System.currentTimeMillis()
    if (now - lastSentAt < 18_000L) return
    if (!sending.compareAndSet(false, true)) return
    lastSentAt = now
    val phone = BlypShellSession.phone(context).orEmpty()
    if (phone.isEmpty()) {
      sending.set(false)
      return
    }
    val body = BlypShellPlaceCodec.encodeUpdate(sid, location.latitude, location.longitude)
    val clientId = UUID.randomUUID().toString()
    BlypShellChatSend.sendTextAsync(context, phone, cid, body, clientId) { ok, msg, _ ->
      sending.set(false)
      if (!ok || msg == null) return@sendTextAsync
      val local = BlypShellChatMessagesStore.loadRawObjects(context, phone, cid)
      val merged = BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(msg))
      BlypShellChatMessagesStore.saveMerged(context, phone, cid, merged)
      BlypShellUiRefresh.notifyChatChanged(cid)
    }
  }
}
