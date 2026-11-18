package com.haroldndougou.blyp.paymentannounce

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.shell.BlypShellEntry

/**
 * Alertes fondateur (dashboard admin) — push data-only `type=admin_alert`.
 * Visible même si MIUI ignore title/body Expo ; aucune donnée sensible hors titre/texte.
 */
object AdminAlertPresenter {
  const val TYPE = "admin_alert"
  private const val CHANNEL_ID = "admin_alerts"

  fun isAdminAlert(data: Map<String, String>): Boolean = data["type"] == TYPE

  fun show(context: Context, data: Map<String, String>) {
    val title = data["title"]?.trim().orEmpty()
    val body = data["message"]?.trim().orEmpty()
    if (title.isEmpty() && body.isEmpty()) return

    val app = context.applicationContext
    ensureChannel(app)

    val openApp =
      PendingIntent.getActivity(
        app,
        0,
        BlypShellEntry.primaryTaskIntent(app),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val eventId = data["eventId"]?.trim().orEmpty()
    val notifId = if (eventId.isNotEmpty()) eventId.hashCode() else System.currentTimeMillis().toInt()

    val notification =
      NotificationCompat.Builder(app, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.drawable.ic_stat_blyp)
        .setColor(0xFF5DC705.toInt())
        .setAutoCancel(true)
        .setContentIntent(openApp)
        .setCategory(NotificationCompat.CATEGORY_EVENT)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setGroup("blyp_admin")
        .build()

    val mgr = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.notify(notifId, notification)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
      NotificationChannel(CHANNEL_ID, "Alertes Blyp (fondateur)", NotificationManager.IMPORTANCE_DEFAULT)
        .apply {
          description = "Inscriptions, transactions et recharges"
          setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), null)
        }
    mgr.createNotificationChannel(channel)
  }
}
