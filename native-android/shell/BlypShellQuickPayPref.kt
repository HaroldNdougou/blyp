package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.quickpaynotif.QuickPayNativeSecrets
import com.haroldndougou.blyp.quickpaynotif.QuickPayNotifService
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

/**
 * Payer depuis la notification — calque RN (`syncQuickPayNotif` + watcher BLE).
 * Scan seulement si on ne diffuse pas ; le tap ouvre l’auth native.
 */
object BlypShellQuickPayPref {
  private const val PREFS = "blyp_quick_pay_notif_v1"
  private const val KEY = "enabled"
  private val main = Handler(Looper.getMainLooper())

  @Volatile private var appContext: Context? = null
  @Volatile private var attached = false
  private var unsubNearby: (() -> Unit)? = null
  private var unsubBroadcast: (() -> Unit)? = null
  private var lastPeerSig = ""
  private var debouncePeer: BlypShellNearbyScan.Peer? = null
  private val applyDebounced =
    Runnable {
      applyPeer(appContext ?: return@Runnable, debouncePeer)
    }

  fun isEnabled(context: Context): Boolean {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY, false)
  }

  fun attachShell(context: Context) {
    val app = context.applicationContext
    appContext = app
    if (attached) {
      if (isEnabled(app)) ensureRunning(app)
      return
    }
    attached = true
    if (isEnabled(app)) startEngine(app)
  }

  /** La notification cherche toute seule, même si l’écran de l’app est fermé. */
  fun ensureRunning(context: Context) {
    val app = context.applicationContext
    appContext = app
    if (!isEnabled(app)) return
    if (BlypShellPayRuntime.readPinOnly(app).isNullOrBlank()) return
    if (unsubNearby == null) {
      unsubNearby =
        BlypShellNearbyScan.subscribe { peer ->
          debouncePeer = peer
          main.removeCallbacks(applyDebounced)
          main.postDelayed(applyDebounced, 280L)
        }
    }
    if (unsubBroadcast == null) {
      unsubBroadcast =
        BlypShellTaxiBroadcast.subscribe {
          refreshScan(app)
        }
    }
    refreshScan(app)
    applyPeer(app, BlypShellNearbyScan.snapshot())
  }

  /** Bouton « Scanner » de la notification : repart de zéro, tout de suite. */
  fun rescan(context: Context) {
    val app = context.applicationContext
    if (!isEnabled(app)) return
    ensureRunning(app)
    mirrorCleared(app)
    BlypShellNearbyScan.startForQuickPay(app)
    BlypShellNearbyScan.restart(app)
  }

  fun setEnabled(context: Context, enabled: Boolean): Boolean {
    val app = context.applicationContext
    appContext = app
    if (!enabled) {
      persist(app, false)
      stopEngine(app)
      return true
    }
    if (BlypShellPayRuntime.readPinOnly(app).isNullOrBlank()) {
      persist(app, false)
      return false
    }
    persist(app, true)
    startEngine(app)
    return true
  }

  fun onSignOut(context: Context) {
    val app = context.applicationContext
    persist(app, false)
    stopEngine(app)
  }

  private fun persist(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, enabled).apply()
  }

  private fun startEngine(context: Context) {
    val app = context.applicationContext
    pushNotif(app, null)
    syncSecrets(app, null, null)
    if (unsubNearby == null) {
      unsubNearby =
        BlypShellNearbyScan.subscribe { peer ->
          debouncePeer = peer
          main.removeCallbacks(applyDebounced)
          main.postDelayed(applyDebounced, 280L)
        }
    }
    if (unsubBroadcast == null) {
      unsubBroadcast =
        BlypShellTaxiBroadcast.subscribe {
          refreshScan(app)
        }
    }
    refreshScan(app)
    applyPeer(app, BlypShellNearbyScan.snapshot())
  }

  private fun stopEngine(context: Context) {
    main.removeCallbacks(applyDebounced)
    unsubNearby?.invoke()
    unsubNearby = null
    unsubBroadcast?.invoke()
    unsubBroadcast = null
    lastPeerSig = ""
    BlypShellNearbyScan.stopForQuickPay()
    QuickPayNotifService.stop(context.applicationContext)
    QuickPayNativeSecrets.clear(context.applicationContext)
  }

  private fun refreshScan(context: Context) {
    if (!isEnabled(context)) return
    BlypShellNearbyScan.startForQuickPay(context)
  }

  /** Le commerçant vu sur Payer s’affiche aussi sur la notification. */
  fun mirrorRecipient(
    context: Context,
    accountId: String,
    name: String,
    phoneDigits: String?,
  ) {
    if (!isEnabled(context)) return
    val id = accountId.trim()
    val shown = name.trim()
    if (id.isEmpty() || shown.isEmpty()) return
    lastPeerSig = id.uppercase()
    val peer =
      BlypShellNearbyScan.Peer(
        accountId = id,
        phoneDigits = phoneDigits?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty(),
        displayName = shown,
        category = null,
        rssi = 0,
        lastSeenAt = System.currentTimeMillis(),
      )
    pushNotif(context, peer, shown)
    syncSecrets(context, peer, shown)
  }

  fun mirrorCleared(context: Context) {
    if (!isEnabled(context)) return
    lastPeerSig = ""
    pushNotif(context, null)
    syncSecrets(context, null, null)
  }

  private fun applyPeer(context: Context, peer: BlypShellNearbyScan.Peer?) {
    if (!isEnabled(context)) return
    val usable = peer?.takeIf { !isOwnPeer(context, it) }
    if (usable != null && BlypShellPayRuntime.activeRecipientFromQr(context)) {
      val held = BlypShellPayRuntime.activeRecipientAccountId(context)
      if (held != null && !held.equals(usable.accountId, ignoreCase = true)) return
    }
    val sig = usable?.accountId?.trim()?.uppercase().orEmpty()
    if (sig == lastPeerSig) return
    lastPeerSig = sig
    if (usable == null) {
      pushNotif(context, null)
      syncSecrets(context, null, null)
      BlypShellPayRuntime.clearBleRecipient(context)
      return
    }
    val cached = BlypShellPeerNames.cached(context, usable.accountId)
    val shown = cached?.trim().orEmpty().ifEmpty { usable.displayName.trim() }
    pushNotif(context, usable, shown)
    syncSecrets(context, usable, shown)
    sharePeerToPay(context, usable, shown)
    if (BlypShellPayEligibility.isCommercePayAccountId(usable.accountId)) {
      BlypShellPayDossierRam.prefetchMerchant(context, usable.accountId.trim().uppercase())
    }
    BlypShellPeerNames.resolveAsync(context, usable.accountId) { resolved ->
      if (!isEnabled(context)) return@resolveAsync
      val name = resolved.trim().ifEmpty { shown }
      if (name.isEmpty()) return@resolveAsync
      if (!usable.accountId.equals(BlypShellPayRuntime.activeRecipientAccountId(context), true) &&
        BlypShellPayRuntime.activeRecipientFromQr(context)
      ) {
        return@resolveAsync
      }
      pushNotif(context, usable, name)
      syncSecrets(context, usable, name)
      sharePeerToPay(context, usable, name)
    }
  }

  private fun sharePeerToPay(
    context: Context,
    peer: BlypShellNearbyScan.Peer,
    name: String,
  ) {
    if (BlypShellPayRuntime.activeRecipientFromQr(context)) {
      val held = BlypShellPayRuntime.activeRecipientAccountId(context)
      if (held != null && !held.equals(peer.accountId, ignoreCase = true)) return
    }
    val shown = name.trim().ifEmpty { peer.displayName.trim() }
    if (shown.isEmpty()) return
    BlypShellPayRuntime.applyRecipient(
      context,
      BlypShellPayRuntime.RecipientOption(
        accountId = peer.accountId,
        name = shown,
        phoneDigits = peer.phoneDigits.ifBlank { null },
        category = peer.category,
        fromBle = true,
      ),
    )
  }

  private fun isOwnPeer(context: Context, peer: BlypShellNearbyScan.Peer): Boolean {
    val mine = BlypShellSession.accountId(context)?.trim()?.uppercase().orEmpty()
    if (mine.isNotEmpty() && mine == peer.accountId.uppercase()) return true
    val phone =
      BlypShellSession.phone(context)?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty()
    return phone.length == 9 && phone == peer.phoneDigits
  }

  private fun pushNotif(
    context: Context,
    peer: BlypShellNearbyScan.Peer?,
    displayName: String = peer?.displayName?.trim().orEmpty(),
  ) {
    val loc = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val fmt = NumberFormat.getIntegerInstance(loc)
    val name = displayName.trim()
    val phone = peer?.phoneDigits?.replace(Regex("\\D"), "").orEmpty()
    val body =
      if (name.isEmpty()) {
        context.getString(R.string.blyp_shell_profile_quick_pay_body_empty)
      } else {
        ""
      }
    val initial =
      name.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
    QuickPayNotifService.start(
      context,
      context.getString(R.string.blyp_shell_profile_quick_pay_title),
      body,
      name,
      initial,
      null,
      fmt.format(50),
      fmt.format(100),
      fmt.format(200),
      fmt.format(500),
      merchantKey = peer?.accountId?.trim().orEmpty(),
      phoneDigits = phone,
    )
  }

  private fun syncSecrets(
    context: Context,
    peer: BlypShellNearbyScan.Peer?,
    displayName: String?,
  ) {
    val runtime = BlypShellRuntime.readFresh(context) ?: run {
      QuickPayNativeSecrets.clear(context)
      return
    }
    val pin = BlypShellPayRuntime.readPinOnly(context) ?: run {
      QuickPayNativeSecrets.clear(context)
      return
    }
    val recipientJson =
      if (peer == null) {
        ""
      } else {
        JSONObject()
          .put("accountId", peer.accountId.trim())
          .put("name", displayName?.trim().orEmpty().ifEmpty { peer.displayName.trim() })
          .put("phoneDigits", peer.phoneDigits.ifBlank { JSONObject.NULL })
          .toString()
      }
    val balance = BlypShellSession.profile(context)?.balanceFcfa ?: 0
    val phone = BlypShellSession.phone(context)?.replace(Regex("\\D"), "").orEmpty()
    QuickPayNativeSecrets.sync(
      context,
      runtime.apiBaseUrl,
      runtime.accessToken,
      recipientJson,
      pin,
      balance,
      phone,
    )
  }
}
