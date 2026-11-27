package com.haroldndougou.blyp.paymentannounce

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.shell.BlypShellEntry

/**
 * Alertes fondateur — push data-only `type=admin_alert`.
 * Recharge et retrait : sonnerie d'alarme et vibration longue.
 */
object AdminAlertPresenter {
  const val TYPE = "admin_alert"
  private const val CHANNEL_ID = "admin_alerts"
  private const val ALARM_CHANNEL_ID = "blyp_money_alarm_v2"
  private val ALARM_VIBE =
    longArrayOf(0, 900, 200, 900, 200, 900, 200, 900, 200, 1200, 300, 1200, 300, 1600)

  fun isAdminAlert(data: Map<String, String>): Boolean = data["type"] == TYPE

  fun prepare(context: Context) {
    val app = context.applicationContext
    ensureAlarmChannel(app)
    ensureChannel(app)
  }

  fun show(context: Context, data: Map<String, String>) {
    val title = data["title"]?.trim().orEmpty()
    val body = data["message"]?.trim().orEmpty()
    if (title.isEmpty() && body.isEmpty()) return
    val alarm = data["alarm"] == "1" || data["eventType"] == "deposit" || data["eventType"] == "withdrawal"

    val app = context.applicationContext
    val channelId = if (alarm) ALARM_CHANNEL_ID else CHANNEL_ID
    if (alarm) ensureAlarmChannel(app) else ensureChannel(app)

    val openApp =
      PendingIntent.getActivity(
        app,
        0,
        BlypShellEntry.primaryTaskIntent(app),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val eventId = data["eventId"]?.trim().orEmpty()
    val notifId = if (eventId.isNotEmpty()) eventId.hashCode() else System.currentTimeMillis().toInt()
    val text = title.ifEmpty { body }

    val builder =
      NotificationCompat.Builder(app, channelId)
        .setContentTitle(text)
        .setSmallIcon(R.drawable.ic_stat_blyp)
        .setColor(0xFF5DC705.toInt())
        .setAutoCancel(true)
        .setContentIntent(openApp)
        .setGroup("blyp_admin")

    if (alarm) {
      builder
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVibrate(ALARM_VIBE)
        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      buzz(app)
    } else {
      builder
        .setContentText(body.ifEmpty { text })
        .setCategory(NotificationCompat.CATEGORY_EVENT)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
    }

    val mgr = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.notify(notifId, builder.build())
  }

  private fun buzz(context: Context) {
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
    if (!vibrator.hasVibrator()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createWaveform(ALARM_VIBE, -1))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(ALARM_VIBE, -1)
    }
  }

  private fun ensureAlarmChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.deleteNotificationChannel("blyp_money_alarm")
    if (mgr.getNotificationChannel(ALARM_CHANNEL_ID) != null) return
    val alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    val audio =
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    val channel =
      NotificationChannel(ALARM_CHANNEL_ID, "Demandes d'argent", NotificationManager.IMPORTANCE_MAX)
        .apply {
          description = "Recharge et retrait à confirmer"
          enableVibration(true)
          vibrationPattern = ALARM_VIBE
          setSound(alarm, audio)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
          setBypassDnd(true)
        }
    mgr.createNotificationChannel(channel)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
      NotificationChannel(CHANNEL_ID, "Alertes Blyp (fondateur)", NotificationManager.IMPORTANCE_DEFAULT)
        .apply {
          description = "Inscriptions, ouvertures et messages"
          setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), null)
        }
    mgr.createNotificationChannel(channel)
  }
}
