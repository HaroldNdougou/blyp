package com.haroldndougou.blyp.bleforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.haroldndougou.blyp.R

/**
 * Garde le process vivant pendant la diffusion BLE taxi (Android exige startForeground).
 */
class BleBroadcastForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      BleBroadcastForegroundBridge.emitStopRequested()
      stopSelf()
      return START_NOT_STICKY
    }

    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Blyp"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    val stopLabel = intent?.getStringExtra(EXTRA_STOP_LABEL) ?: "Stop"

    ensureChannel()
    val notification = buildNotification(title, body, stopLabel)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        getString(R.string.blyp_shell_commerce_online_notif_channel),
        NotificationManager.IMPORTANCE_MIN,
      ).apply {
        description = getString(R.string.blyp_shell_commerce_online_notif_body)
        setShowBadge(false)
        setSound(null, null)
        enableLights(false)
        enableVibration(false)
        vibrationPattern = null
        lockscreenVisibility = Notification.VISIBILITY_SECRET
      }
    mgr.createNotificationChannel(channel)
  }

  private fun buildNotification(
    title: String,
    body: String,
    stopLabel: String,
  ): Notification {
    val openApp =
      PendingIntent.getActivity(
        this,
        0,
        com.haroldndougou.blyp.shell.BlypShellEntry.primaryTaskIntent(this),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    val stopIntent =
      Intent(this, BleBroadcastForegroundService::class.java).apply {
        action = ACTION_STOP
      }
    val stopPending =
      PendingIntent.getService(
        this,
        1,
        stopIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(R.drawable.ic_stat_blyp)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp)
      .addAction(0, stopLabel, stopPending)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setVisibility(NotificationCompat.VISIBILITY_SECRET)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    const val CHANNEL_ID = "blyp_online_min"
    private const val NOTIFICATION_ID = 9001
    private const val ACTION_STOP = "com.haroldndougou.blyp.action.STOP_BLE_BROADCAST"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_STOP_LABEL = "stopLabel"

    fun start(context: Context, title: String, body: String, stopLabel: String) {
      val intent =
        Intent(context, BleBroadcastForegroundService::class.java).apply {
          putExtra(EXTRA_TITLE, title)
          putExtra(EXTRA_BODY, body)
          putExtra(EXTRA_STOP_LABEL, stopLabel)
        }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, BleBroadcastForegroundService::class.java))
    }
  }
}
