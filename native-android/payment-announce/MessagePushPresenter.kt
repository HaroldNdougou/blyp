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

    PaymentAnnounceModule.emitIncomingMessage(data)

    val viewing =
      isAppInForeground(context) &&
        PaymentAnnouncePrefs.getActiveConversation(context) == conversationId
    if (viewing) return

    val rawBody =
      data["body"]?.takeIf { it.isNotBlank() }
        ?: data["message"].orEmpty()
    val isReaction = isReactionPayload(data, rawBody)
    val emoji = parseReactionEmoji(rawBody, data)
    if (isReaction && emoji.isEmpty()) return

    showMessageReceived(context, conversationId, data)
    if (!isReaction) {
      ConversationReceiptAck.markDelivered(context, conversationId)
    }
  }

  /** Notif « Harold a récupéré les 1000F » — tap ouvre la bulle money. */
  fun handleMoneyClaimed(context: Context, data: Map<String, String>) {
    PaymentAnnounceModule.emitMoneyClaimed(data)
    val conversationId = data["conversationId"]?.trim().orEmpty()
    val transferId = data["transferId"]?.trim().orEmpty()
    if (conversationId.isEmpty() || transferId.isEmpty()) return

    val viewing =
      isAppInForeground(context) &&
        PaymentAnnouncePrefs.getActiveConversation(context) == conversationId
    if (viewing) return

    showMoneyClaimed(context, conversationId, transferId, data)
  }

  /** « Jean a dit merci » — tap ouvre la bulle money. */
  fun handleMoneyTray(context: Context, data: Map<String, String>) {
    PaymentAnnounceModule.emitMoneyTray(data)
    val conversationId = data["conversationId"]?.trim().orEmpty()
    val transferId = data["transferId"]?.trim().orEmpty()
    if (conversationId.isEmpty() || transferId.isEmpty()) return

    val viewing =
      isAppInForeground(context) &&
        PaymentAnnouncePrefs.getActiveConversation(context) == conversationId
    if (viewing) return

    showMoneyClaimed(context, conversationId, transferId, data)
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
    val rawBody =
      data["body"]?.trim().orEmpty().ifEmpty {
        data["message"]?.trim().orEmpty()
      }
    val body =
      formatMessageBody(
        rawBody,
        data["messageType"]?.trim().orEmpty(),
        PaymentAnnouncePrefs.getLang(app),
        parseReactionEmoji(rawBody, data),
      ).ifEmpty { fromName }

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
        .setSmallIcon(R.drawable.ic_stat_blyp)
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

  private fun showMoneyClaimed(
    context: Context,
    conversationId: String,
    transferId: String,
    data: Map<String, String>,
  ) {
    val app = context.applicationContext
    ensureChannel(app)

    val lang = PaymentAnnouncePrefs.getLang(app)
    val type = data["type"]?.trim().orEmpty()
    val fromName =
      data["claimedByName"]?.trim().orEmpty().ifEmpty {
        data["fromName"]?.trim().orEmpty()
      }.ifEmpty {
        data["title"]?.trim().orEmpty()
      }.ifEmpty {
        data["claimedByFirstName"]?.trim().orEmpty()
      }.ifEmpty {
        data["thanksFirstName"]?.trim().orEmpty()
      }.ifEmpty { "Blyp" }
    val body = formatMoneyBody(type, lang)
    val notifId = "$type:$transferId".hashCode()

    val uri =
      Uri.parse("blyp://chat/${Uri.encode(conversationId)}")
        .buildUpon()
        .appendQueryParameter("transferId", transferId)
        .build()
    val openChat =
      PendingIntent.getActivity(
        app,
        notifId,
        Intent(Intent.ACTION_VIEW, uri).apply {
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
        .setSmallIcon(R.drawable.ic_stat_blyp)
        .setColor(0xFF5DC705.toInt())
        .setAutoCancel(true)
        .setContentIntent(openChat)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setDefaults(NotificationCompat.DEFAULT_VIBRATE)
        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        .build()

    val mgr = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    mgr.notify(notifId, notification)
  }

  private fun formatMoneyBody(type: String, lang: String): String {
    val fr = lang == "fr"
    return when (type) {
      "money_thanks" -> if (fr) "a dit merci" else "said thanks"
      else -> if (fr) "a récupéré l'argent" else "claimed the money"
    }
  }

  private fun isReactionSync(raw: String): Boolean {
    val t = raw.trim()
    return t.startsWith("\u200B\u200BR") || t.startsWith("BLYP_R")
  }

  private fun isReactionPayload(data: Map<String, String>, rawBody: String): Boolean {
    return data["messageType"]?.equals("reaction", ignoreCase = true) == true ||
      isReactionSync(rawBody)
  }

  private fun parseReactionEmoji(raw: String, data: Map<String, String>): String {
    val fromData = data["emoji"]?.trim().orEmpty()
    if (fromData.isNotEmpty()) return fromData
    val t = raw.trim()
    val prefixes = arrayOf("BLYP_R|", "\u200B\u200BR|")
    for (p in prefixes) {
      if (t.startsWith(p)) {
        val rest = t.substring(p.length)
        val sep = rest.lastIndexOf('|')
        if (sep >= 0) return rest.substring(sep + 1)
      }
    }
    return ""
  }

  private fun formatMessageBody(
    raw: String,
    messageType: String,
    lang: String,
    emoji: String,
  ): String {
    if (isReactionPayload(mapOf("messageType" to messageType), raw) || emoji.isNotEmpty()) {
      val e = emoji.trim()
      if (e.isEmpty()) return ""
      return if (lang == "fr") "a réagi $e à votre message" else "reacted $e to your message"
    }
    val isVoice =
      messageType.equals("voice", ignoreCase = true) ||
        raw == "VOICE" ||
        raw == "🎤"
    if (!isVoice) return raw
    return if (lang == "fr") "🎤 Message vocal" else "🎤 Voice message"
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
