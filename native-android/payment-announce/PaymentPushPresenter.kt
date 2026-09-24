package com.haroldndougou.blyp.paymentannounce

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import com.haroldndougou.blyp.MainActivity
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/**
 * Notif paiement reçu — toujours visible (indépendant d’Expo data-only / MIUI).
 */
object PaymentPushPresenter {
  const val CHANNEL_ID = "payments"

  fun showPaymentReceived(context: Context, data: Map<String, String>) {
    val amount = data["amountFcfa"]?.toIntOrNull() ?: return
    if (amount <= 0) return

    val app = context.applicationContext
    ensureChannel(app)

    val lang = PaymentAnnouncePrefs.getLang(app)
    val title = paymentTitle(lang)
    val body = formatBody(amount, data["fromName"], lang)

    val openApp =
      PendingIntent.getActivity(
        app,
        0,
        Intent(app, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    val txId = data["transactionId"]?.trim().orEmpty()
    val notifId = if (txId.isNotEmpty()) txId.hashCode() else System.currentTimeMillis().toInt()

    val notification =
      NotificationCompat.Builder(app, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(R.mipmap.ic_launcher)
        .setColor(0xFF5DC705.toInt())
        .setAutoCancel(true)
        .setContentIntent(openApp)
        .setCategory(NotificationCompat.CATEGORY_EVENT)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setDefaults(NotificationCompat.DEFAULT_VIBRATE)
        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        .build()

    val mgr = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.notify(notifId, notification)
  }

  private fun paymentTitle(lang: String): String =
    if (lang == "fr") "Paiement reçu" else "Payment received"

  private fun formatBody(amount: Int, fromName: String?, lang: String): String {
    val locale = if (lang == "fr") Locale.FRANCE else Locale.US
    val label = NumberFormat.getNumberInstance(locale).format(amount)
    val from = fromName?.trim().takeUnless { it.isNullOrEmpty() } ?: "Blyp"
    return if (lang == "fr") "${label}F reçus de $from" else "${label}F received from $from"
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        "Paiements",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Paiements reçus"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 100, 80, 100)
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
