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
    if (intent?.action != ACTION_STOP &&
      intent?.action != ACTION_ADD &&
      intent?.action != ACTION_CLEAR_BASKET
    ) {
      /** Visible tout de suite (état gardé en mémoire) ; le moteur de détection démarre juste après. */
      ensureChannel()
      show(buildNotification())
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
          show(buildNotification())
          QuickPayAuthActivity.start(this, amount)
        }
        return START_STICKY
      }
      ACTION_REFRESH -> {
        highlighted = intent.getIntExtra(EXTRA_HIGHLIGHT, 0)
        ensureChannel()
        show(buildNotification())
        return START_STICKY
      }
      ACTION_CLEAR_HIGHLIGHT -> {
        highlighted = 0
        ensureChannel()
        show(buildNotification())
        return START_STICKY
      }
      ACTION_ADD -> {
        val add = intent.getIntExtra(QuickPayActionReceiver.EXTRA_AMOUNT, 0)
        if (add > 0) bumpBasket(add)
        ensureChannel()
        show(buildNotification())
        return START_STICKY
      }
      ACTION_CLEAR_BASKET -> {
        resetBasket()
        ensureChannel()
        show(buildNotification())
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
      resetBasket()
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
    show(buildNotification())
    val phone = intent?.getStringExtra(EXTRA_PHONE)
    if (phone != null) maybeLoadAvatar(phone)
    return START_STICKY
  }

  override fun onCreate() {
    super.onCreate()
    live = this
  }

  override fun onDestroy() {
    if (live === this) live = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun paintHighlight(amount: Int) {
    highlighted = amount
    ensureChannel()
    show(buildNotification())
  }

  private fun repaint() {
    ensureChannel()
    show(buildNotification())
  }

  private fun merchantReady(): Boolean = QuickPayNativeSecrets.isReady(this)

  private var shown = false

  private fun show(notification: Notification) {
    if (!shown) {
      postForeground(notification)
      shown = true
    } else {
      val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      mgr.notify(NOTIFICATION_ID, notification)
    }
  }

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
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Montants rapides depuis la barre de notifications"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(false)
        setSound(null, null)
      }
    mgr.deleteNotificationChannel("blyp_quick_pay")
    mgr.createNotificationChannel(channel)
  }

  private fun clearPending(): PendingIntent {
    val intent =
      Intent(this, QuickPayActionReceiver::class.java).apply {
        action = QuickPayActionReceiver.ACTION_CLEAR
      }
    return PendingIntent.getBroadcast(
      this,
      8,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun addPending(amount: Int, requestCode: Int): PendingIntent {
    val intent =
      Intent(this, QuickPayActionReceiver::class.java).apply {
        action = ACTION_ADD
        putExtra(QuickPayActionReceiver.EXTRA_AMOUNT, amount)
      }
    return PendingIntent.getBroadcast(
      this,
      40 + requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
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
    label: CharSequence,
    viewId: Int,
    requestCode: Int,
    openApp: PendingIntent,
  ) {
    remote.setTextViewText(viewId, label)
    val n = countFor(amount)
    val countId = countViewId(amount)
    if (!merchantReady()) {
      remote.setOnClickPendingIntent(viewId, notReadyPending(requestCode))
      remote.setFloat(viewId, "setAlpha", 0.42f)
      remote.setInt(viewId, "setBackgroundResource", R.drawable.quick_pay_chip_default)
      remote.setTextColor(viewId, getColor(R.color.quick_pay_chip_text))
      if (countId != 0) remote.setViewVisibility(countId, View.GONE)
      return
    }
    remote.setFloat(viewId, "setAlpha", 1f)
    val tap = addPending(amount, requestCode)
    remote.setOnClickPendingIntent(viewId, tap)
    val chipId = chipViewId(amount)
    if (chipId != 0) remote.setOnClickPendingIntent(chipId, tap)
    if (n > 0) {
      remote.setInt(viewId, "setBackgroundColor", 0xFF5DC705.toInt())
      remote.setTextColor(viewId, 0xFFFFFFFF.toInt())
    } else {
      remote.setInt(viewId, "setBackgroundResource", R.drawable.quick_pay_chip_default)
      remote.setTextColor(viewId, getColor(R.color.quick_pay_chip_text))
    }
    if (countId != 0 && n > 1) {
      remote.setViewVisibility(countId, View.VISIBLE)
      remote.setTextViewText(countId, "x$n")
      remote.setOnClickPendingIntent(countId, tap)
    } else if (countId != 0) {
      remote.setViewVisibility(countId, View.GONE)
    }
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
        show(buildNotification())
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
        show(buildNotification())
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
    remote.setViewVisibility(R.id.quick_pay_sum_row, View.VISIBLE)
    if (basket > 0) {
      remote.setViewVisibility(R.id.quick_pay_total, View.VISIBLE)
      remote.setTextViewText(R.id.quick_pay_total, fmt.format(basket))
      remote.setViewVisibility(R.id.quick_pay_clear, View.VISIBLE)
      remote.setOnClickPendingIntent(R.id.quick_pay_clear, clearPending())
      remote.setOnClickPendingIntent(R.id.quick_pay_pay, payActivityPending(basket, 9))
    } else {
      remote.setViewVisibility(R.id.quick_pay_total, View.INVISIBLE)
      remote.setViewVisibility(R.id.quick_pay_clear, View.GONE)
      remote.setOnClickPendingIntent(R.id.quick_pay_pay, openApp)
    }
    val amounts = intArrayOf(50, 100, 500)
    val ids =
      intArrayOf(
        R.id.quick_pay_amount_50,
        R.id.quick_pay_amount_100,
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
    val contentLine = if (merchantReady()) cachedMerchantName else cachedBody

    val collapsed = buildAmountRemoteViews(openApp)
    collapsed.setViewVisibility(R.id.quick_pay_amounts, View.GONE)
    collapsed.setViewVisibility(R.id.quick_pay_sum_row, View.GONE)
    val expanded = buildAmountRemoteViews(openApp)

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(cachedTitle)
      .setContentText(contentLine)
      .setSmallIcon(R.drawable.ic_stat_blyp)
      .setColor(0xFF5DC705.toInt())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(openApp)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(collapsed)
      .setCustomBigContentView(expanded)
      .build()
  }

  companion object {
    const val CHANNEL_ID = "blyp_quick_pay_quiet"
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
    private const val ACTION_ADD = "com.haroldndougou.blyp.action.QUICK_PAY_ADD"
    private const val ACTION_CLEAR_BASKET = "com.haroldndougou.blyp.action.QUICK_PAY_CLEAR_BASKET"
    private const val ACTION_TOGGLE = "com.haroldndougou.blyp.action.QUICK_PAY_TOGGLE"

    /** Montant touché : vert tant que l’utilisateur n’a pas choisi un autre bouton. */
    @Volatile private var highlighted = 0
    @Volatile private var basket = 0
    @Volatile private var count50 = 0
    @Volatile private var count100 = 0
    @Volatile private var count500 = 0
    @Volatile private var extra = 0
    @Volatile private var live: QuickPayNotifService? = null
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

    fun addAmount(context: Context, amountFcfa: Int) {
      if (amountFcfa <= 0) return
      val svc = live
      if (svc != null) {
        bumpBasket(amountFcfa)
        svc.repaint()
        return
      }
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          action = ACTION_ADD
          putExtra(QuickPayActionReceiver.EXTRA_AMOUNT, amountFcfa)
        }
      startServiceIntent(context, intent)
    }

    fun clearBasket(context: Context) {
      val svc = live
      if (svc != null) {
        resetBasket()
        svc.repaint()
        return
      }
      resetBasket()
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          action = ACTION_CLEAR_BASKET
        }
      startServiceIntent(context, intent)
    }

    private fun bumpBasket(amount: Int) {
      when (amount) {
        50 -> count50++
        100 -> count100++
        500 -> count500++
        else -> extra = (extra + amount).coerceAtMost(9_999_999)
      }
      basket = (50 * count50 + 100 * count100 + 500 * count500 + extra).coerceAtMost(9_999_999)
      highlighted = amount
    }

    private fun resetBasket() {
      count50 = 0
      count100 = 0
      count500 = 0
      extra = 0
      basket = 0
      highlighted = 0
    }

    private fun countFor(amount: Int): Int =
      when (amount) {
        50 -> count50
        100 -> count100
        500 -> count500
        else -> 0
      }

    private fun countViewId(amount: Int): Int =
      when (amount) {
        50 -> R.id.quick_pay_count_50
        100 -> R.id.quick_pay_count_100
        500 -> R.id.quick_pay_count_500
        else -> 0
      }

    private fun chipViewId(amount: Int): Int =
      when (amount) {
        50 -> R.id.quick_pay_chip_50
        100 -> R.id.quick_pay_chip_100
        500 -> R.id.quick_pay_chip_500
        else -> 0
      }

    fun highlightAmount(context: Context, amountFcfa: Int) {
      val svc = live
      if (svc != null) {
        svc.paintHighlight(amountFcfa)
        return
      }
      val intent =
        Intent(context, QuickPayNotifService::class.java).apply {
          action = ACTION_REFRESH
          putExtra(EXTRA_HIGHLIGHT, amountFcfa)
        }
      startServiceIntent(context, intent)
    }

    fun clearHighlight(context: Context) {
      val svc = live
      if (svc != null) {
        svc.paintHighlight(0)
        return
      }
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
