package com.haroldndougou.blyp.paymentannounce

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.haroldndougou.blyp.R

/**
 * Notif message reçu — même chemin que le paiement (indépendant d’Expo / MIUI).
 */
object MessagePushPresenter {
  const val CHANNEL_ID = "messages"

  fun handle(context: Context, data: Map<String, String>) {
    val conversationId = data["conversationId"]?.trim().orEmpty()
    if (conversationId.isEmpty()) return

    PaymentAnnounceModule.emitIncomingMessage(conversationId)

    val viewing =
      isAppInForeground(context) &&
        PaymentAnnouncePrefs.getActiveConversation(context) == conversationId
    if (viewing) return

    showMessageReceived(context, conversationId, data)
  }

  fun dismiss(context: Context, conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.cancel(id.hashCode())
  }

  private fun showMessageReceived(
    context: Context,
    conversationId: String,
    data: Map<String, String>,
  ) {
    val app = context.applicationContext
    ensureChannel(app)

    val fromName = data["fromName"]?.trim().orEmpty().ifEmpty { "Blyp" }
    val body =
      data["body"]?.trim().orEmpty().ifEmpty {
        data["message"]?.trim().orEmpty()
      }.ifEmpty { fromName }

    val openChat =
      PendingIntent.getActivity(
        app,
        conversationId.hashCode(),
        Intent(Intent.ACTION_VIEW, Uri.parse("blyp://chat/${Uri.encode(conversationId)}")).apply {
          setPackage(app.packageName)
          flags =
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
              Intent.FLAG_ACTIVITY_CLEAR_TOP or
              Intent.FLAG_ACTIVITY_NEW_TASK
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    val notification =
      NotificationCompat.Builder(app, CHANNEL_ID)
        .setContentTitle(fromName)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.mipmap.ic_launcher)
        .setColor(0xFF5DC705.toInt())
        .setAutoCancel(true)
        .setContentIntent(openChat)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setDefaults(NotificationCompat.DEFAULT_VIBRATE)
        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        .build()

    val mgr = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.notify(conversationId.hashCode(), notification)
  }

  private fun isAppInForeground(context: Context): Boolean {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
    val procs = am.runningAppProcesses ?: return false
    return procs.any {
      it.processName == context.packageName &&
        it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        "Messages",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Messages"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 80)
        setSound(
          sound,
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        enableLights(true)
        lightColor = 0xFF5DC705.toInt()
      }
    mgr.createNotificationChannel(channel)
  }
}
