package com.haroldndougou.blyp.quickpaynotif

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.view.View
import android.widget.RemoteViews
import java.text.NumberFormat
import java.util.Locale
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.haroldndougou.blyp.R

class QuickPayNotifService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action != ACTION_STOP) {
      /** Visible tout de suite (état gardé en mémoire) ; le moteur de détection démarre juste après. */
      ensureChannel()
      postForeground(buildNotification())
      val app = applicationContext
      Handler(Looper.getMainLooper()).post {
        com.haroldndougou.blyp.shell.BlypShellQuickPayPref.ensureRunning(app)
      }
    }
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_PAY -> {
        val amount = intent.getIntExtra(EXTRA_PAY_AMOUNT, 0)
        if (amount > 0 && merchantReady()) {
          ensureChannel()
          postForeground(buildNotification())
          QuickPayAuthActivity.start(this, amount)
        }
        return START_STICKY
      }
      ACTION_REFRESH -> {
        highlighted = intent.getIntExtra(EXTRA_HIGHLIGHT, 0)
        ensureChannel()
        postForeground(buildNotification())
        return START_STICKY
      }
      ACTION_CLEAR_HIGHLIGHT -> {
        highlighted = 0
        ensureChannel()
        postForeground(buildNotification())
        return START_STICKY
      }
    }

    cachedTitle = intent?.getStringExtra(EXTRA_TITLE) ?: cachedTitle.ifBlank { "Blyp" }
    cachedBody = intent?.getStringExtra(EXTRA_BODY) ?: cachedBody
    cachedMerchantName = intent?.getStringExtra(EXTRA_MERCHANT_NAME) ?: cachedMerchantName
    cachedMerchantInitial =
      intent?.getStringExtra(EXTRA_MERCHANT_INITIAL) ?: cachedMerchantInitial
    val newKey = intent?.getStringExtra(EXTRA_MERCHANT_KEY)
    if (newKey != null && newKey != cachedMerchantKey) {
      cachedMerchantKey = newKey
      cachedAvatar = null
      loadedAvatarPhone = ""
      avatarInFlight = ""
      cachedPhone = ""
    }
    if (intent?.hasExtra(EXTRA_PHONE) == true) {
      cachedPhone = intent.getStringExtra(EXTRA_PHONE).orEmpty()
    }
    val avatarB64 = intent?.getStringExtra(EXTRA_MERCHANT_AVATAR_B64)
    if (!avatarB64.isNullOrBlank() && avatarB64 != cachedAvatarBase64) {
      cachedAvatarBase64 = avatarB64
      decodeAvatarAsync(avatarB64)
    }
    cachedL50 = intent?.getStringExtra(EXTRA_L50) ?: cachedL50.ifBlank { "50" }
    cachedL100 = intent?.getStringExtra(EXTRA_L100) ?: cachedL100.ifBlank { "100" }
    cachedL200 = intent?.getStringExtra(EXTRA_L200) ?: cachedL200.ifBlank { "350" }
    cachedL500 = intent?.getStringExtra(EXTRA_L500) ?: cachedL500.ifBlank { "500" }

    ensureChannel()
    postForeground(buildNotification())
    val phone = intent?.getStringExtra(EXTRA_PHONE)
    if (phone != null) maybeLoadAvatar(phone)
    return START_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun merchantReady(): Boolean = QuickPayNativeSecrets.isReady(this)

  private fun postForeground(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val types =
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
          android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      startForeground(NOTIFICATION_ID, notification, types)
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

  private fun payActivityPending(amount: Int, requestCode: Int): PendingIntent {
    val intent =
      Intent(this, QuickPayAuthActivity::class.java).apply {
        putExtra(QuickPayAuthActivity.EXTRA_AMOUNT, amount)
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_NO_HISTORY or
            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
        )
      }
    val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(this, requestCode, intent, piFlags)
  }

  private fun bindAmountChip(
    remote: RemoteViews,
    amount: Int,
    label: String,
    viewId: Int,
    requestCode: Int,
    openApp: PendingIntent,
  ) {
    remote.setTextViewText(viewId, label)
    if (!merchantReady()) {
      remote.setOnClickPendingIntent(viewId, notReadyPending(requestCode))
      remote.setFloat(viewId, "setAlpha", 0.42f)
      remote.setInt(viewId, "setBackgroundResource", R.drawable.quick_pay_chip_default)
      remote.setTextColor(viewId, getColor(R.color.quick_pay_chip_text))
      return
    }
    remote.setFloat(viewId, "setAlpha", 1f)
    remote.setOnClickPendingIntent(viewId, payActivityPending(amount, requestCode))
    val picked = highlighted == amount
    remote.setInt(
      viewId,
      "setBackgroundResource",
      if (picked) R.drawable.quick_pay_chip_selected else R.drawable.quick_pay_chip_default,
    )
    remote.setTextColor(
      viewId,
      getColor(if (picked) R.color.quick_pay_chip_text_selected else R.color.quick_pay_chip_text),
    )
  }

  private fun bindMerchantProfile(remote: RemoteViews) {
    val name = cachedMerchantName.trim()
    val phone = formatPhone(cachedPhone)
    if (name.isEmpty()) {
      remote.setViewVisibility(R.id.quick_pay_merchant_name, View.GONE)
    } else {
      remote.setViewVisibility(R.id.quick_pay_merchant_name, View.VISIBLE)
      remote.setTextViewText(R.id.quick_pay_merchant_name, name)
    }
    if (name.isNotEmpty() && phone.isNotEmpty()) {
      remote.setViewVisibility(R.id.quick_pay_merchant_phone, View.VISIBLE)
      remote.setTextViewText(R.id.quick_pay_merchant_phone, "· $phone")
      remote.setViewVisibility(R.id.quick_pay_body, View.GONE)
    } else {
      remote.setViewVisibility(R.id.quick_pay_merchant_phone, View.GONE)
      remote.setViewVisibility(R.id.quick_pay_body, if (name.isEmpty()) View.VISIBLE else View.GONE)
      remote.setTextViewText(R.id.quick_pay_body, cachedBody)
    }

    val initial =
      cachedMerchantInitial.trim().ifBlank { "?" }.take(2).uppercase()
    remote.setTextViewText(R.id.quick_pay_avatar_initial, initial)

    val photo = cachedAvatar
    if (photo != null) {
      remote.setImageViewBitmap(R.id.quick_pay_avatar, photo)
      remote.setViewVisibility(R.id.quick_pay_avatar, View.VISIBLE)
      remote.setViewVisibility(R.id.quick_pay_avatar_initial, View.GONE)
    } else {
      remote.setViewVisibility(R.id.quick_pay_avatar, View.GONE)
      remote.setViewVisibility(R.id.quick_pay_avatar_initial, View.VISIBLE)
    }
  }

  private fun maybeLoadAvatar(phoneRaw: String) {
    val phone =
      phoneRaw.filter { it.isDigit() }.let { if (it.length >= 9) it.takeLast(9) else it }
    if (phone.length < 8) return
    if (phone == loadedAvatarPhone && cachedAvatar != null) return
    if (avatarInFlight == phone) return
    val url =
      com.haroldndougou.blyp.shell.BlypShellPeerAvatar.urlForPhone(this, phone) ?: return
    avatarInFlight = phone
    val keyAtStart = cachedMerchantKey
    Thread {
      val bmp =
        runCatching {
          com.haroldndougou.blyp.shell.BlypShellAvatarLoader.fetchBitmap(url)
        }.getOrNull()
      val circle = bmp?.let { circle(it) }
      Handler(Looper.getMainLooper()).post {
        if (cachedMerchantKey != keyAtStart) return@post
        avatarInFlight = ""
        if (circle == null) return@post
        loadedAvatarPhone = phone
        cachedAvatar = circle
        ensureChannel()
        postForeground(buildNotification())
      }
    }.start()
  }

  private fun decodeAvatarAsync(b64: String) {
    Thread {
      val bmp =
        runCatching {
          val bytes = Base64.decode(b64, Base64.DEFAULT)
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { circle(it) }
        }.getOrNull()
      Handler(Looper.getMainLooper()).post {
        if (cachedAvatarBase64 != b64 || bmp == null) return@post
        cachedAvatar = bmp
        ensureChannel()
        postForeground(buildNotification())
      }
    }.start()
  }

  private fun circle(src: Bitmap): Bitmap {
    val size = 128
    val scaled = Bitmap.createScaledBitmap(src, size, size, true)
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    canvas.drawBitmap(scaled, 0f, 0f, paint)
    if (scaled !== src) scaled.recycle()
    return out
  }

  private fun notReadyPending(requestCode: Int): PendingIntent {
    val intent =
      Intent(this, QuickPayActionReceiver::class.java).apply {
        action = ACTION_NOT_READY
      }
    return PendingIntent.getBroadcast(
      this,
      80 + requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** Rien de détecté : toucher la notification ouvre l’app sur Payer. */
  private fun openPayPending(): PendingIntent {
    val intent = com.haroldndougou.blyp.shell.BlypShellEntry.shellHomeIntent(this)
    return PendingIntent.getActivity(
      this,
      71,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun scanPending(): PendingIntent {
    val intent =
      Intent(this, QuickPayActionReceiver::class.java).apply {
        action = ACTION_SCAN
      }
    return PendingIntent.getBroadcast(
      this,
      72,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun stayPending(): PendingIntent {
    val intent =
      Intent(this, QuickPayActionReceiver::class.java).apply {
        action = ACTION_STAY
      }
    return PendingIntent.getBroadcast(
      this,
      70,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun buildAmountRemoteViews(openApp: PendingIntent): RemoteViews {
    val remote = RemoteViews(packageName, R.layout.notification_quick_pay)
    bindMerchantProfile(remote)
    remote.setOnClickPendingIntent(R.id.quick_pay_scan, scanPending())
    val loc = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val fmt = NumberFormat.getIntegerInstance(loc)
    val amounts = intArrayOf(100, 150, 200, 250, 300, 350, 400, 500)
    val ids =
      intArrayOf(
        R.id.quick_pay_amount_100,
        R.id.quick_pay_amount_150,
        R.id.quick_pay_amount_200,
        R.id.quick_pay_amount_250,
        R.id.quick_pay_amount_300,
        R.id.quick_pay_amount_350,
        R.id.quick_pay_amount_400,
        R.id.quick_pay_amount_500,
      )
    for (i in amounts.indices) {
      bindAmountChip(remote, amounts[i], fmt.format(amounts[i]), ids[i], i + 1, openApp)
    }
    bindOtherAmount(remote)
    return remote
  }

  private fun formatPhone(digits: String): String {
    val d = digits.filter { it.isDigit() }.let { if (it.length >= 9) it.takeLast(9) else it }
    if (d.length < 8) return ""
    val parts = ArrayList<String>(4)
    parts.add(d.take(3))
    var i = 3
    while (i < d.length) {
      parts.add(d.substring(i, minOf(i + 2, d.length)))
      i += 2
    }
    return parts.joinToString(" ")
  }

  private fun bindOtherAmount(remote: RemoteViews) {
    val viewId = R.id.quick_pay_amount_other
    remote.setTextViewText(viewId, getString(R.string.quick_pay_other_chip))
    if (!merchantReady()) {
      remote.setOnClickPendingIntent(viewId, notReadyPending(5))
      remote.setFloat(viewId, "setAlpha", 0.42f)
      return
    }
    remote.setFloat(viewId, "setAlpha", 1f)
    val intent =
      Intent(this, QuickPayAmountActivity::class.java).apply {
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_NO_HISTORY or
            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
        )
      }
    remote.setOnClickPendingIntent(
      viewId,
      PendingIntent.getActivity(
        this,
        5,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      ),
    )
  }

  private fun buildNotification(): Notification {
    val openApp = if (merchantReady()) stayPending() else openPayPending()

    val amounts = buildAmountRemoteViews(openApp)
    val contentLine =
      if (merchantReady()) cachedMerchantName else cachedBody

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(cachedTitle)
      .setContentText(contentLine)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setColor(getColor(R.color.quick_pay_notif_tint))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(amounts)
      .setCustomBigContentView(amounts)
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
    private const val ACTION_STAY = "com.haroldndougou.blyp.action.QUICK_PAY_STAY"
    private const val ACTION_SCAN = QuickPayActionReceiver.ACTION_SCAN
    private const val ACTION_NOT_READY = "com.haroldndougou.blyp.action.QUICK_PAY_NOT_READY"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_MERCHANT_NAME = "merchantName"
    private const val EXTRA_MERCHANT_INITIAL = "merchantInitial"
    private const val EXTRA_MERCHANT_AVATAR_B64 = "merchantAvatarB64"
    private const val EXTRA_L50 = "l50"
    private const val EXTRA_L100 = "l100"
    private const val EXTRA_L200 = "l200"
    private const val EXTRA_L500 = "l500"
    private const val EXTRA_HIGHLIGHT = "highlightAmount"
    private const val EXTRA_PAY_AMOUNT = "payAmountFcfa"
    private const val EXTRA_MERCHANT_KEY = "merchantKey"
    private const val EXTRA_PHONE = "phoneDigits"
    private const val ACTION_TOGGLE = "com.haroldndougou.blyp.action.QUICK_PAY_TOGGLE"

    /** Montant touché : vert tant que l’authentification / le paiement est en cours. */
    @Volatile private var highlighted = 0
    private var cachedTitle = ""
    private var cachedBody = ""
    private var cachedMerchantName = ""
    private var cachedMerchantInitial = "?"
    private var cachedAvatarBase64: String? = null
    private var cachedAvatar: Bitmap? = null
    private var cachedMerchantKey = ""
    private var loadedAvatarPhone = ""
    private var avatarInFlight = ""
    private var cachedPhone = ""
    private var cachedL50 = ""
    private var cachedL100 = ""
    private var cachedL200 = ""
    private var cachedL500 = ""

    fun start(
      context: Context,
      title: String,
      body: String,
      merchantName: String,
      merchantInitial: String,
      merchantAvatarB64: String?,
      l50: String,
      l100: String,
      l200: String,
      l500: String,
      merchantKey: String = "",
      phoneDigits: String = "",
    ) {
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          putExtra(EXTRA_TITLE, title)
          putExtra(EXTRA_BODY, body)
          putExtra(EXTRA_MERCHANT_NAME, merchantName)
          putExtra(EXTRA_MERCHANT_INITIAL, merchantInitial)
          putExtra(EXTRA_MERCHANT_AVATAR_B64, merchantAvatarB64 ?: "")
          putExtra(EXTRA_L50, l50)
          putExtra(EXTRA_L100, l100)
          putExtra(EXTRA_L200, l200)
          putExtra(EXTRA_L500, l500)
          if (merchantKey.isNotEmpty() || merchantName.isEmpty()) {
            putExtra(EXTRA_MERCHANT_KEY, merchantKey)
          }
          if (phoneDigits.isNotEmpty() || merchantName.isEmpty()) {
            putExtra(EXTRA_PHONE, phoneDigits)
          }
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
      cachedAvatar = null
      cachedPhone = ""
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
