package com.haroldndougou.blypadmin

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

/** Copier dans android/.../blypadmin après prebuild. */
object AdminNotificationChannels {
  private const val MONEY_ID = "blyp_money_alarm"
  private const val ADMIN_ID = "admin_alerts"
  private val MONEY_VIBE =
    longArrayOf(0, 900, 200, 900, 200, 900, 200, 900, 200, 1200, 300, 1200, 300, 1600)

  fun ensure(app: Application) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = app.getSystemService(NotificationManager::class.java) ?: return

    val alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    val alarmAudio =
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    val money =
      NotificationChannel(MONEY_ID, "Demandes d'argent", NotificationManager.IMPORTANCE_MAX).apply {
        description = "Recharge et retrait à confirmer"
        enableVibration(true)
        vibrationPattern = MONEY_VIBE
        setSound(alarm, alarmAudio)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setBypassDnd(true)
      }
    mgr.createNotificationChannel(money)

    val alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val admin =
      NotificationChannel(ADMIN_ID, "Alertes Blyp", NotificationManager.IMPORTANCE_HIGH).apply {
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 250, 120, 250)
        setSound(
          alertUri,
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
    mgr.createNotificationChannel(admin)
  }
}