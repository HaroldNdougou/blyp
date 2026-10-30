package com.haroldndougou.blyp.quickpaynotif

import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.haroldndougou.blyp.MainActivity
import com.haroldndougou.blyp.R

class QuickPayNotifService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_PAY -> {
        val amount = intent.getIntExtra(EXTRA_PAY_AMOUNT, 0)
        if (amount > 0) {
          highlightedAmountFcfa = amount
          ensureChannel()
          postForeground(buildNotification())
          QuickPayAuthActivity.start(this, amount)
        }
        return START_STICKY
      }
      ACTION_REFRESH -> {
        highlightedAmountFcfa = intent.getIntExtra(EXTRA_HIGHLIGHT, 0)
        ensureChannel()
        postForeground(buildNotification())
        return START_STICKY
      }
      ACTION_CLEAR_HIGHLIGHT -> {
        highlightedAmountFcfa = 0
        ensureChannel()
        postForeground(buildNotification())
        return START_STICKY
      }
    }

    cachedTitle = intent?.getStringExtra(EXTRA_TITLE) ?: cachedTitle.ifBlank { "Blyp" }
    cachedBody = intent?.getStringExtra(EXTRA_BODY) ?: cachedBody
    cachedL50 = intent?.getStringExtra(EXTRA_L50) ?: cachedL50.ifBlank { "50" }
    cachedL100 = intent?.getStringExtra(EXTRA_L100) ?: cachedL100.ifBlank { "100" }
    cachedL200 = intent?.getStringExtra(EXTRA_L200) ?: cachedL200.ifBlank { "200" }
    cachedL500 = intent?.getStringExtra(EXTRA_L500) ?: cachedL500.ifBlank { "500" }
    highlightedAmountFcfa = 0

    ensureChannel()
    postForeground(buildNotification())
    return START_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun postForeground(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        "Paiement rapide",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Montants rapides depuis la barre de notifications"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(false)
        setSound(null, null)
      }
    mgr.createNotificationChannel(channel)
  }

  private fun payLaunchIntent(amount: Int): Intent =
    Intent(this, QuickPayAuthActivity::class.java).apply {
      putExtra(QuickPayAuthActivity.EXTRA_AMOUNT, amount)
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_NO_HISTORY or
          Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
      )
    }

  private fun payActivityPending(amount: Int, requestCode: Int): PendingIntent {
    val intent = payLaunchIntent(amount)
    val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val opts =
        ActivityOptions.makeBasic().apply {
          setPendingIntentBackgroundActivityStartMode(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED,
          )
        }.toBundle()
      return PendingIntent.getActivity(this, requestCode, intent, piFlags, opts)
    }
    return PendingIntent.getActivity(this, requestCode, intent, piFlags)
  }

  private fun payPending(amount: Int, requestCode: Int): PendingIntent = payActivityPending(amount, requestCode)

  private fun bindAmountChip(
    remote: RemoteViews,
    amount: Int,
    label: String,
    viewId: Int,
    requestCode: Int,
  ) {
    remote.setTextViewText(viewId, label)
    remote.setOnClickPendingIntent(viewId, payPending(amount, requestCode))
    val selected = highlightedAmountFcfa == amount
    remote.setInt(
      viewId,
      "setBackgroundResource",
      if (selected) R.drawable.quick_pay_chip_selected else R.drawable.quick_pay_chip_default,
    )
    remote.setTextColor(
      viewId,
      if (selected) {
        getColor(R.color.quick_pay_chip_text_selected)
      } else {
        getColor(R.color.quick_pay_chip_text)
      },
    )
  }

  private fun buildAmountRemoteViews(): RemoteViews {
    val remote = RemoteViews(packageName, R.layout.notification_quick_pay)
    remote.setTextViewText(R.id.quick_pay_body, cachedBody)
    bindAmountChip(remote, 50, cachedL50, R.id.quick_pay_amount_50, 1)
    bindAmountChip(remote, 100, cachedL100, R.id.quick_pay_amount_100, 2)
    bindAmountChip(remote, 200, cachedL200, R.id.quick_pay_amount_200, 3)
    bindAmountChip(remote, 500, cachedL500, R.id.quick_pay_amount_500, 4)
    return remote
  }

  private fun buildNotification(): Notification {
    val openApp =
      PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    val amounts = buildAmountRemoteViews()

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(cachedTitle)
      .setContentText(cachedBody)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setColor(getColor(R.color.blyp_accent))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(amounts)
      .setCustomBigContentView(amounts)
      .addAction(0, cachedL50, payActivityPending(50, 11))
      .addAction(0, cachedL100, payActivityPending(100, 12))
      .addAction(0, cachedL200, payActivityPending(200, 13))
      .addAction(0, cachedL500, payActivityPending(500, 14))
      .build()
  }

  companion object {
    const val CHANNEL_ID = "blyp_quick_pay"
    private const val NOTIFICATION_ID = 9002
    private const val ACTION_STOP = "com.haroldndougou.blyp.action.STOP_QUICK_PAY_NOTIF"
    private const val ACTION_PAY = "com.haroldndougou.blyp.action.QUICK_PAY_AMOUNT"
    private const val ACTION_REFRESH = "com.haroldndougou.blyp.action.REFRESH_QUICK_PAY_NOTIF"
    private const val ACTION_CLEAR_HIGHLIGHT =
      "com.haroldndougou.blyp.action.CLEAR_QUICK_PAY_HIGHLIGHT"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_L50 = "l50"
    private const val EXTRA_L100 = "l100"
    private const val EXTRA_L200 = "l200"
    private const val EXTRA_L500 = "l500"
    private const val EXTRA_HIGHLIGHT = "highlightAmount"
    private const val EXTRA_PAY_AMOUNT = "payAmountFcfa"

    private var cachedTitle = ""
    private var cachedBody = ""
    private var cachedL50 = ""
    private var cachedL100 = ""
    private var cachedL200 = ""
    private var cachedL500 = ""
    private var highlightedAmountFcfa = 0

    fun start(
      context: Context,
      title: String,
      body: String,
      l50: String,
      l100: String,
      l200: String,
      l500: String,
    ) {
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          putExtra(EXTRA_TITLE, title)
          putExtra(EXTRA_BODY, body)
          putExtra(EXTRA_L50, l50)
          putExtra(EXTRA_L100, l100)
          putExtra(EXTRA_L200, l200)
          putExtra(EXTRA_L500, l500)
        }
      startServiceIntent(context, intent)
    }

    fun highlightAmount(context: Context, amountFcfa: Int) {
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          action = ACTION_REFRESH
          putExtra(EXTRA_HIGHLIGHT, amountFcfa)
        }
      startServiceIntent(context, intent)
    }

    fun clearHighlight(context: Context) {
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          action = ACTION_CLEAR_HIGHLIGHT
        }
      startServiceIntent(context, intent)
    }

    fun stop(context: Context) {
      highlightedAmountFcfa = 0
      context.stopService(Intent(context, QuickPayNotifService::class.java))
    }

    private fun startServiceIntent(context: Context, intent: Intent) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }
}
