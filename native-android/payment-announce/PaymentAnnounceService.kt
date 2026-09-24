package com.haroldndougou.blyp.paymentannounce

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.haroldndougou.blyp.R

/**
 * FGS court — audio arrière-plan (cash + TTS) quand un push paiement arrive.
 */
class PaymentAnnounceService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val amount = intent?.getIntExtra(EXTRA_AMOUNT, 0) ?: 0
    val lang = intent?.getStringExtra(EXTRA_LANG) ?: "fr"
    if (amount <= 0) {
      stopSelf()
      return START_NOT_STICKY
    }

    ensureChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    val done = AtomicBoolean(false)
    fun finishOnce() {
      if (!done.compareAndSet(false, true)) return
      PaymentAnnounceAudio.release(applicationContext)
      ServiceCompat.stopForeground(
        this@PaymentAnnounceService,
        ServiceCompat.STOP_FOREGROUND_REMOVE,
      )
      stopSelf()
    }
    PaymentAnnounceEngine.announce(applicationContext, amount, lang, ::finishOnce)
    mainHandler.postDelayed({ finishOnce() }, MAX_ANNOUNCE_MS)

    return START_NOT_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        "Annonce paiement",
        NotificationManager.IMPORTANCE_MIN,
      ).apply {
        description = "Lecture vocale des paiements reçus"
        setShowBadge(false)
        setSound(null, null)
      }
    mgr.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.app_name))
      .setContentText("…")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setColor(0xFF5DC705.toInt())
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()

  companion object {
    private const val CHANNEL_ID = "blyp_pay_announce"
    private const val NOTIFICATION_ID = 9002
    private const val MAX_ANNOUNCE_MS = 12_000L
    private const val EXTRA_AMOUNT = "amount"
    private const val EXTRA_LANG = "lang"

    fun start(context: Context, amountFcfa: Int, lang: String) {
      val intent =
        Intent(context, PaymentAnnounceService::class.java).apply {
          putExtra(EXTRA_AMOUNT, amountFcfa)
          putExtra(EXTRA_LANG, lang)
        }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }
}
