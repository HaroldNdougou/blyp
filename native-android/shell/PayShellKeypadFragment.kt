package com.haroldndougou.blyp.shell

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Onglet Payer de la coque native — clavier + paiement HTTP si configuré. */
class PayShellKeypadFragment : Fragment() {
  private var amountView: TextView? = null
  private var backspaceRepeat: Runnable? = null
  private var balanceView: TextView? = null
  private var recipientNameView: TextView? = null
  private var recipientPhoneView: TextView? = null
  private var recipientInitialView: TextView? = null
  private var recipientAvatarView: android.widget.ImageView? = null
  private var paySuccessView: TextView? = null
  private var feeView: TextView? = null
  private var balanceRowView: View? = null
  private var balancePendingView: TextView? = null
  private var receiveView: android.widget.ImageView? = null
  private var recipientRadioView: View? = null
  private var recipientSearchingView: View? = null
  private var unsubBroadcast: (() -> Unit)? = null
  /** Destinataire venu d’un QR — prioritaire sur la détection jusqu’à la prochaine relance (calque RN). */
  private var qrRecipientId: String? = null
  /** Type commerce lu dans le QR (aucune requête) — affiché sous le nom. */
  private var qrCategory: String? = null
  private var lastRefreshAt = 0L
  private var refreshingUntil = 0L
  private var searchPulseUntil = 0L
  private var searchSettled = false
  private val advertisePermLauncher =
    registerForActivityResult(
      androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
    ) { _ ->
      val ctx = context ?: return@registerForActivityResult
      if (BlypShellTaxiBroadcast.hasAdvertisePermission(ctx)) setReceiveNearby(ctx, true)
    }
  private var successHideRunnable: Runnable? = null
  private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private var unsubRefresh: (() -> Unit)? = null
  private var unsubNearby: (() -> Unit)? = null
  private var radioEnableView: TextView? = null
  /** En-tête « Bluetooth éteint » à la place du commerce. */
  private var radioOffShown = false
  /** Dernier pair BLE appliqué ; effacé quand le pair disparaît (calque RN `bleRecipient`). */
  private var lastNearbyAppliedId: String? = null
  private var scanPermissionAsked = false
  private val scanPermissionLauncher =
    registerForActivityResult(
      androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
      if (!isAdded) return@registerForActivityResult
      if (granted.values.all { it }) {
        startNearbyScan()
      } else if (forcedPermissionAt > 0L &&
        System.currentTimeMillis() - forcedPermissionAt < 450L
      ) {
        openAppSettings()
      }
      forcedPermissionAt = 0L
      bindRecipient()
    }
  /** Tap « Activer » : refus instantané = « ne plus demander » → réglages app (calque `prepareInteractive`). */
  private var forcedPermissionAt = 0L
  private var btPromptInFlight = false
  private var radioReceiver: android.content.BroadcastReceiver? = null
  private var locationPromptInFlight = false
  private val locationOnLauncher =
    registerForActivityResult(
      androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult(),
    ) { res ->
      locationPromptInFlight = false
      val ctx = context ?: return@registerForActivityResult
      if (res.resultCode == android.app.Activity.RESULT_OK) {
        BlypShellNearbyScan.restart(ctx)
      } else {
        BlypShellNearbyScan.locationPromptDeclined = true
      }
      bindRecipient()
    }
  private val bluetoothOnLauncher =
    registerForActivityResult(
      androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
    ) { res ->
      btPromptInFlight = false
      if (res.resultCode != android.app.Activity.RESULT_OK) {
        BlypShellNearbyScan.bluetoothPromptDeclined = true
      }
      bindRecipient()
    }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_pay_cold_overlay, container, false)
    requireContext().let { c ->
      BlypShellPayRuntime.dropLegacyStickyRecipientOnce(c)
      if (BlypShellNearbyScan.snapshot() == null) BlypShellPayRuntime.clearBleRecipient(c)
      BlypShellPayRuntime.clearExpiredQrRecipient(c)
    }
    root.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.blyp_shell_bg))
    amountView = root.findViewById(R.id.blyp_cold_amount)
    balanceView = root.findViewById(R.id.blyp_cold_balance)
    recipientNameView = root.findViewById(R.id.blyp_cold_recipient_name)
    recipientPhoneView = root.findViewById(R.id.blyp_cold_recipient_phone)
    recipientInitialView = root.findViewById(R.id.blyp_cold_recipient_initial)
    recipientAvatarView = root.findViewById(R.id.blyp_cold_recipient_avatar)
    paySuccessView = root.findViewById(R.id.blyp_cold_pay_success)
    feeView = root.findViewById(R.id.blyp_cold_fee)
    balanceRowView = root.findViewById(R.id.blyp_cold_balance_row)
    balancePendingView = root.findViewById(R.id.blyp_cold_balance_pending)
    receiveView = root.findViewById(R.id.blyp_pay_receive)
    recipientRadioView = root.findViewById(R.id.blyp_cold_recipient_radio)
    recipientSearchingView = root.findViewById(R.id.blyp_cold_recipient_searching)
    bindKeypad(root)
    refreshAmount()
    PayOverlayUi.syncPayKey(root, PayShellState.amountFcfa())
    bindBalance()
    balanceRowView?.setOnClickListener {
      context?.let { PayShellHandoff.openDeposit(it) }
    }
    root.findViewById<View>(R.id.blyp_pay_top_up)?.setOnClickListener {
      context?.let { PayShellHandoff.openDeposit(it) }
    }
    root.findViewById<View>(R.id.blyp_pay_qr)?.let { qrBtn ->
      qrBtn.isClickable = true
      qrBtn.isFocusable = true
      // Ouverture au doigt posé = ressenti instantané (cible déjà 48 dp).
      qrBtn.setOnTouchListener { v, ev ->
        if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN && isAdded) {
          v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
          keepQrOnStop = true
          ShellPayScanActivity.start(requireContext())
          true
        } else {
          false
        }
      }
    }
    receiveView?.setOnClickListener { onReceiveNearbyTap() }
    PayOverlayUi.bindQuickAmounts(
      root,
      { amount -> PayShellState.setAmountFcfa(amount) },
      { refreshAmount() },
      { amount -> attemptPay(amount) },
    )
    radioEnableView = root.findViewById(R.id.blyp_cold_radio_enable)
    radioEnableView?.setText(R.string.blyp_shell_ble_enable)
    radioEnableView?.setOnClickListener { forceRadioPrompts() }
    root.findViewById<View>(R.id.blyp_cold_recipient_row)?.setOnClickListener {
      if (radioOffShown) forceRadioPrompts() else refreshNearby()
    }
    bindTapOutsideClearsQuick(root)
    return root
  }

  override fun onStart() {
    super.onStart()
    unsubRefresh =
      BlypShellUiRefresh.subscribe {
        bindBalance()
        bindRecipient()
        warmDossierForCurrentAmount()
      }
    unsubBroadcast =
      BlypShellTaxiBroadcast.subscribe {
        mainHandler.post {
          if (!isAdded) return@post
          bindReceiveToggle()
          bindRecipient()
        }
      }
    registerRadioReceiver()
    startNearbyScan()
  }

  override fun onStop() {
    unsubBroadcast?.invoke()
    unsubBroadcast = null
    unregisterRadioReceiver()
    unsubRefresh?.invoke()
    unsubRefresh = null
    unsubNearby?.invoke()
    unsubNearby = null
    BlypShellNearbyScan.stop()
    if (!keepQrOnStop) dropQrRecipient()
    keepQrOnStop = false
    stopBackspaceRepeat()
    super.onStop()
  }

  override fun onHiddenChanged(hidden: Boolean) {
    super.onHiddenChanged(hidden)
    if (hidden) {
      dropQrRecipient()
      BlypShellNearbyScan.stop()
      stopBackspaceRepeat()
    } else if (isResumed || isVisible) {
      startNearbyScan()
    }
  }

  /** Scan pair le plus proche tant que Payer est visible (calque `useNearbyTaxi`). */
  private fun startNearbyScan() {
    if (isHidden) return
    val ctx = context ?: return
    expireQrIfDue()
    if (BlypShellNearbyScan.snapshot() == null && qrRecipientId == null &&
      BlypShellPayRuntime.clearBleRecipient(ctx)
    ) {
      lastNearbyAppliedId = null
      bindRecipient()
      BlypShellQuickPayPref.mirrorCleared(ctx)
    }
    if (BlypShellTaxiBroadcast.snapshot(ctx).on && BlypShellSession.isCommerceMode(ctx)) return
    if (!BlypShellBlePayPref.isEnabled(ctx)) {
      bindRecipient()
      return
    }
    if (unsubNearby == null) {
      unsubNearby = BlypShellNearbyScan.subscribe { peer -> onNearbyPeer(peer) }
    }
    if (!BlypShellNearbyScan.hasScanPermission(ctx)) {
      if (!scanPermissionAsked) {
        scanPermissionAsked = true
        scanPermissionLauncher.launch(BlypShellNearbyScan.scanPermissions())
      }
      return
    }
    BlypShellNearbyScan.start(ctx)
    maybePromptRadios(ctx)
    if (!searchSettled) armSearchPulse()
    mainHandler.postDelayed({ if (isAdded) bindRecipient() }, 4_300L)
  }

  /** Tap sur l’en-tête = relance la détection (calque `onRefreshNearbyTaxi` + `refreshTaxiScan`). */
  private fun refreshNearby() {
    val ctx = context ?: return
    if (BlypShellTaxiBroadcast.snapshot(ctx).on && BlypShellSession.isCommerceMode(ctx)) return
    if (!BlypShellBlePayPref.isEnabled(ctx)) return
    val now = android.os.SystemClock.elapsedRealtime()
    if (now - lastRefreshAt < REFRESH_DEBOUNCE_MS) return
    lastRefreshAt = now
    val qrId = qrRecipientId
    qrRecipientId = null
    qrCategory = null
    if (qrId != null && BlypShellPayRuntime.activeRecipientAccountId(ctx) == qrId) {
      BlypShellPayRuntime.clearActiveRecipient(ctx)
    }
    lastNearbyAppliedId = null
    BlypShellNearbyScan.locationPromptDeclined = false
    BlypShellNearbyScan.bluetoothPromptDeclined = false
    if (!BlypShellNearbyScan.hasScanPermission(ctx)) {
      forcedPermissionAt = System.currentTimeMillis()
      scanPermissionLauncher.launch(BlypShellNearbyScan.scanPermissions())
      return
    }
    if (unsubNearby == null) {
      unsubNearby = BlypShellNearbyScan.subscribe { peer -> onNearbyPeer(peer) }
    }
    BlypShellPayRuntime.clearBleRecipient(ctx)
    searchSettled = false
    BlypShellNearbyScan.restart(ctx)
    maybePromptRadios(ctx)
    refreshingUntil = now + REFRESH_UI_MAX_MS
    armSearchPulse()
    mainHandler.postDelayed({ if (isAdded) bindRecipient() }, REFRESH_UI_MAX_MS)
  }

  private fun armSearchPulse() {
    searchPulseUntil = android.os.SystemClock.elapsedRealtime() + SEARCH_PULSE_MS
    bindRecipient()
    mainHandler.postDelayed({ if (isAdded) bindRecipient() }, SEARCH_PULSE_MS)
  }

  private fun isSearching(): Boolean =
    android.os.SystemClock.elapsedRealtime() < searchPulseUntil

  /** Popups système comme `prepareBleRadio` : GPS (≤ Android 11), Bluetooth (Android 13+). */
  private fun maybePromptRadios(ctx: android.content.Context) {
    if (BlypShellNearbyScan.needsLocation() &&
      !BlypShellNearbyScan.isLocationOn(ctx) &&
      !BlypShellNearbyScan.locationPromptDeclined
    ) {
      promptLocationOn(ctx)
      return
    }
    if (!BlypShellBluetooth.isOn(ctx) &&
      !BlypShellBluetooth.canEnableSilently() &&
      !BlypShellNearbyScan.bluetoothPromptDeclined &&
      !btPromptInFlight
    ) {
      btPromptInFlight = true
      val ok =
        runCatching {
          bluetoothOnLauncher.launch(
            android.content.Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_ENABLE),
          )
        }.isSuccess
      if (!ok) {
        btPromptInFlight = false
        BlypShellNearbyScan.bluetoothPromptDeclined = true
      }
    }
  }

  private enum class RadioBlock { None, Bluetooth, Location }

  /** Détection impossible après refus — jusqu’à Android 11 la permission demandée est la localisation. */
  private fun radioBlock(ctx: android.content.Context): RadioBlock {
    if (!BlypShellBlePayPref.isEnabled(ctx)) return RadioBlock.None
    if (!BlypShellNearbyScan.hasScanPermission(ctx)) {
      if (!scanPermissionAsked) return RadioBlock.None
      return if (BlypShellNearbyScan.needsLocation()) RadioBlock.Location else RadioBlock.Bluetooth
    }
    if (!BlypShellBluetooth.isOn(ctx)) {
      val refused =
        if (BlypShellBluetooth.canEnableSilently()) {
          BlypShellNearbyScan.silentEnableFailed()
        } else {
          BlypShellNearbyScan.bluetoothPromptDeclined
        }
      return if (refused) RadioBlock.Bluetooth else RadioBlock.None
    }
    if (BlypShellNearbyScan.needsLocation() &&
      !BlypShellNearbyScan.isLocationOn(ctx) &&
      BlypShellNearbyScan.locationPromptDeclined
    ) {
      return RadioBlock.Location
    }
    return RadioBlock.None
  }

  /** Bouton « Activer » : redemande tout, même après un refus (calque `forcePrompt`). */
  private fun forceRadioPrompts() {
    val ctx = context ?: return
    if (radioBlock(ctx) == RadioBlock.Location) {
      BlypShellNearbyScan.locationPromptDeclined = false
    } else {
      BlypShellNearbyScan.bluetoothPromptDeclined = false
    }
    if (!BlypShellNearbyScan.hasScanPermission(ctx)) {
      scanPermissionAsked = true
      forcedPermissionAt = System.currentTimeMillis()
      scanPermissionLauncher.launch(BlypShellNearbyScan.scanPermissions())
      return
    }
    if (!BlypShellBluetooth.isOn(ctx) && BlypShellBluetooth.canEnableSilently()) {
      BlypShellNearbyScan.resetSilentEnable()
      BlypShellNearbyScan.start(ctx)
      bindRecipient()
      if (!BlypShellBluetooth.isOn(ctx)) openBluetoothSettingsIfStuck(ctx)
      return
    }
    BlypShellNearbyScan.start(ctx)
    if (radioBlock(ctx) == RadioBlock.Location) promptLocationOn(ctx) else maybePromptRadios(ctx)
  }

  /** Allumage silencieux refusé par l’appareil → réglages Bluetooth après un court délai. */
  private fun openBluetoothSettingsIfStuck(ctx: android.content.Context) {
    mainHandler.postDelayed({
      if (!isAdded || BlypShellBluetooth.isOn(ctx)) return@postDelayed
      runCatching {
        startActivity(android.content.Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS))
      }
    }, 2_500L)
  }

  private fun openAppSettings() {
    val ctx = context ?: return
    runCatching {
      startActivity(
        android.content.Intent(
          android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          android.net.Uri.fromParts("package", ctx.packageName, null),
        ),
      )
    }
  }

  private fun registerRadioReceiver() {
    val ctx = context ?: return
    if (radioReceiver != null) return
    val r =
      object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context, intent: android.content.Intent) {
          if (intent.action == android.location.LocationManager.PROVIDERS_CHANGED_ACTION &&
            BlypShellNearbyScan.isLocationOn(c)
          ) {
            BlypShellNearbyScan.restart(c)
          }
          bindRecipient()
        }
      }
    radioReceiver = r
    val filter =
      android.content.IntentFilter().apply {
        addAction(android.bluetooth.BluetoothAdapter.ACTION_STATE_CHANGED)
        addAction(android.location.LocationManager.PROVIDERS_CHANGED_ACTION)
      }
    androidx.core.content.ContextCompat.registerReceiver(
      ctx,
      r,
      filter,
      androidx.core.content.ContextCompat.RECEIVER_EXPORTED,
    )
  }

  private fun unregisterRadioReceiver() {
    val r = radioReceiver ?: return
    radioReceiver = null
    runCatching { context?.unregisterReceiver(r) }
  }

  private fun promptLocationOn(ctx: android.content.Context) {
    if (locationPromptInFlight) return
    locationPromptInFlight = true
    val request =
      com.google.android.gms.location.LocationRequest.Builder(
        com.google.android.gms.location.Priority.PRIORITY_BALANCED_POWER_ACCURACY,
        10_000L,
      ).build()
    val settings =
      com.google.android.gms.location.LocationSettingsRequest.Builder()
        .addLocationRequest(request)
        .setAlwaysShow(true)
        .build()
    com.google.android.gms.location.LocationServices.getSettingsClient(ctx)
      .checkLocationSettings(settings)
      .addOnSuccessListener {
        locationPromptInFlight = false
        BlypShellNearbyScan.restart(ctx)
      }
      .addOnFailureListener { e ->
        val resolvable = e as? com.google.android.gms.common.api.ResolvableApiException
        if (resolvable != null && isAdded) {
          val launched =
            runCatching {
              locationOnLauncher.launch(
                androidx.activity.result.IntentSenderRequest.Builder(resolvable.resolution).build(),
              )
            }.isSuccess
          if (launched) return@addOnFailureListener
        }
        locationPromptInFlight = false
        BlypShellNearbyScan.locationPromptDeclined = true
      }
  }

  private fun onNearbyPeer(peer: BlypShellNearbyScan.Peer?) {
    val ctx = context ?: return
    if (peer == null) {
      lastNearbyAppliedId = null
      if (qrRecipientId == null && BlypShellPayRuntime.clearBleRecipient(ctx)) {
        bindRecipient()
        BlypShellQuickPayPref.mirrorCleared(ctx)
      }
      return
    }
    if (isOwnPeer(ctx, peer)) return
    if (BlypShellPayEligibility.isCommercePayAccountId(peer.accountId)) {
      BlypShellPayDossierRam.prefetchMerchant(ctx.applicationContext, peer.accountId.uppercase())
    }
    qrRecipientId?.let { qrId ->
      if (peer.accountId.equals(qrId, ignoreCase = true) ||
        peer.accountId == qrBleBaselineId ||
        peer.rssi < QR_OVERRIDE_RSSI
      ) {
        return
      }
      dropQrRecipient()
    }
    if (peer.accountId == lastNearbyAppliedId) return
    lastNearbyAppliedId = peer.accountId
    searchSettled = true
    applyNearbyRecipient(ctx, peer, BlypShellPeerNames.cached(ctx, peer.accountId) ?: peer.displayName)
    BlypShellPeerNames.resolveAsync(ctx, peer.accountId) { name ->
      val c = context ?: return@resolveAsync
      if (BlypShellPayRuntime.activeRecipientAccountId(c) != peer.accountId) return@resolveAsync
      applyNearbyRecipient(c, peer, name)
    }
  }

  private fun applyNearbyRecipient(
    ctx: android.content.Context,
    peer: BlypShellNearbyScan.Peer,
    name: String,
  ) {
    BlypShellPayRuntime.applyRecipient(
      ctx,
      BlypShellPayRuntime.RecipientOption(
        accountId = peer.accountId,
        name = name,
        phoneDigits = peer.phoneDigits,
        fromBle = true,
      ),
    )
    BlypShellQuickPayPref.mirrorRecipient(ctx, peer.accountId, name, peer.phoneDigits)
    bindRecipient()
    warmDossierForCurrentAmount()
  }

  /** Retour du scan QR : destinataire + montant éventuel (calque `takePendingPayQr`). */
  private fun applyPendingQr() {
    val ctx = context ?: return
    val qr = BlypShellPayQr.takePending() ?: return
    qrRecipientId = qr.accountId
    qrCategory = BlypShellPayQr.normalizeCategory(qr.category)
    searchSettled = true
    BlypShellPayRuntime.holdQrRecipient(qr.accountId)
    qrBleBaselineId = BlypShellNearbyScan.snapshot()?.accountId
    BlypShellPayRuntime.applyRecipient(
      ctx,
      BlypShellPayRuntime.RecipientOption(
        accountId = qr.accountId,
        name = qr.name,
        phoneDigits = BlypShellPayQr.normalizePhone(qr.phoneDigits),
        category = qrCategory,
        fromQr = true,
      ),
    )
    BlypShellQuickPayPref.mirrorRecipient(
      ctx,
      qr.accountId,
      qr.name,
      BlypShellPayQr.normalizePhone(qr.phoneDigits),
    )
    if (BlypShellPayEligibility.isCommercePayAccountId(qr.accountId)) {
      BlypShellPayDossierRam.prefetchMerchant(ctx.applicationContext, qr.accountId)
    }
    val amount = qr.amountFcfa
    if (amount != null && amount > 0) {
      PayShellState.setAmountFcfa(amount)
      view?.let { PayOverlayUi.clearQuickSelection(it) }
      refreshAmount()
    } else {
      warmDossierForCurrentAmount()
    }
    scheduleQrExpiry()
  }

  private val qrExpiryCheck = Runnable { expireQrIfDue() }
  /** Pair BLE déjà là au scan : il ne remplace pas le QR (le payeur l’a écarté en scannant). */
  private var qrBleBaselineId: String? = null
  /** Parcours Payer (PIN / scan) : pas une sortie de l’écran. */
  private var keepQrOnStop = false

  /** Sortie de Payer ou signal plus fort : retour à la détection. */
  private fun dropQrRecipient() {
    val ctx = context ?: return
    mainHandler.removeCallbacks(qrExpiryCheck)
    val had = qrRecipientId != null || BlypShellPayRuntime.activeRecipientFromQr(ctx)
    BlypShellPayRuntime.clearQrRecipient(ctx)
    qrRecipientId = null
    qrCategory = null
    qrBleBaselineId = null
    lastNearbyAppliedId = null
    if (had && isAdded) bindRecipient()
  }

  private fun scheduleQrExpiry() {
    mainHandler.removeCallbacks(qrExpiryCheck)
    if (qrRecipientId == null) return
    mainHandler.postDelayed(qrExpiryCheck, BlypShellPayRuntime.qrHoldRemainingMs() + 50L)
  }

  /** QR : même maintien que le BLE, puis on repasse à la détection. */
  private fun expireQrIfDue() {
    val ctx = context ?: return
    if (BlypShellPayRuntime.clearExpiredQrRecipient(ctx)) {
      qrRecipientId = null
      qrCategory = null
      lastNearbyAppliedId = null
      bindRecipient()
      BlypShellNearbyScan.snapshot()?.let { onNearbyPeer(it) }
      return
    }
    if (qrRecipientId != null && isAdded) scheduleQrExpiry()
  }

  private fun isOwnPeer(ctx: android.content.Context, peer: BlypShellNearbyScan.Peer): Boolean {
    val mine = BlypShellSession.accountId(ctx)?.trim()?.uppercase().orEmpty()
    if (mine.isNotEmpty() && mine == peer.accountId.uppercase()) return true
    val phone = BlypShellSession.phone(ctx)?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty()
    return phone.length == 9 && phone == peer.phoneDigits
  }

  override fun onResume() {
    super.onResume()
    applyPendingQr()
    bindRecipient()
    bindReceiveToggle()
    bindBalance()
    warmDossierForCurrentAmount()
    maybeShowPaySuccessBanner()
  }

  override fun onDestroyView() {
    thumbDetected = null
    mainHandler.removeCallbacks(qrExpiryCheck)
    successHideRunnable?.let { mainHandler.removeCallbacks(it) }
    successHideRunnable = null
    super.onDestroyView()
  }

  /** Tap sur une zone vide de l’écran : annule le montant rapide sélectionné. */
  @android.annotation.SuppressLint("ClickableViewAccessibility")
  private fun bindTapOutsideClearsQuick(root: View) {
    root.setOnTouchListener { _, ev ->
      if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN && PayOverlayUi.hasQuickSelection(root)) {
        PayOverlayUi.clearQuickSelection(root)
        PayShellState.clearDigits()
        refreshAmount()
      }
      false
    }
  }

  private fun maybeShowPaySuccessBanner() {
    val amount = BlypShellPayFeedback.consumeSuccessAmountFcfa()
    if (amount <= 0) return
    /** Vidé seulement une fois l’empreinte / le code validés ; annulation = montant conservé. */
    PayShellState.clearDigits()
    view?.let { PayOverlayUi.clearQuickSelection(it) }
    refreshAmount()
    val banner = paySuccessView ?: return
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val fmt = NumberFormat.getIntegerInstance(locale)
    banner.text = getString(R.string.blyp_shell_pay_success_banner, fmt.format(amount))
    banner.visibility = View.VISIBLE
    successHideRunnable?.let { mainHandler.removeCallbacks(it) }
    val hide =
      Runnable {
        banner.visibility = View.GONE
      }
    successHideRunnable = hide
    mainHandler.postDelayed(hide, 3_500L)
  }

  private fun onReceiveNearbyTap() {
    val ctx = context ?: return
    val snap = BlypShellTaxiBroadcast.snapshot(ctx)
    if (snap.busy) return
    val next = !snap.wantOn
    if (next && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
      val perms =
        arrayOf(
          android.Manifest.permission.BLUETOOTH_ADVERTISE,
          android.Manifest.permission.BLUETOOTH_CONNECT,
        )
      val missing =
        perms.any {
          ContextCompat.checkSelfPermission(ctx, it) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        }
      if (missing) {
        advertisePermLauncher.launch(perms)
        return
      }
    }
    setReceiveNearby(ctx, next)
  }

  /** Intent visible en fond ; à l’écran Payer on scanne toujours. */
  private fun setReceiveNearby(ctx: android.content.Context, on: Boolean) {
    BlypShellTaxiBroadcast.setWantOn(ctx, on)
    startNearbyScan()
    bindReceiveToggle()
    bindRecipient()
  }

  private fun bindReceiveToggle() {
    val ctx = context ?: return
    val v = receiveView ?: return
    val on = BlypShellTaxiBroadcast.snapshot(ctx).wantOn
    v.imageTintList =
      android.content.res.ColorStateList.valueOf(
        ctx.getColor(if (on) R.color.blyp_cold_start_accent else R.color.blyp_cold_start_text_muted),
      )
    v.isActivated = on
  }

  private fun attemptPay(amount: Int) {
    if (amount <= 0) return
    val ctx = context ?: return
    /** Pas de paiement sans Internet (paiement hors ligne : plus tard). */
    if (!BlypShellNetwork.isOnline(ctx)) {
      Toast.makeText(ctx, R.string.blyp_shell_pay_no_internet, Toast.LENGTH_LONG).show()
      return
    }
    if (shouldShowRadioOff(ctx)) {
      bindRecipient()
      forceRadioPrompts()
      return
    }
    if (!BlypShellPayBootstrap.hasTransactionPin(ctx)) {
      ShellPinBootstrapActivity.startIfNeeded(ctx)
      return
    }
    val accountId = BlypShellPayRuntime.activeRecipientAccountId(ctx)?.trim().orEmpty()
    if (accountId.isEmpty()) {
      showNoMerchant()
      return
    }
    if (
      BlypShellPayEligibility.isCommercePayAccountId(accountId) &&
        !BlypShellPayDossierRam.isReadyForPay(amount, accountId.uppercase())
    ) {
      // Vérif locale (quelques ms) si le préchauffage n’a pas encore tourné — pas de faux refus.
      BlypShellPayDossierRam.warmSync(ctx.applicationContext, amount)
      if (!BlypShellPayDossierRam.isReadyForPay(amount, accountId.uppercase())) {
        Toast.makeText(ctx, BlypShellPayDossierRam.denyMessageRes(), Toast.LENGTH_SHORT).show()
        return
      }
    }
    val paySnap = BlypShellPayRuntime.read(ctx)
    if (paySnap != null && amount > paySnap.balanceFcfa) {
      showInsufficientBalanceDialog()
      return
    }
    if (BlypShellPayRuntime.isReady(ctx)) {
      keepQrOnStop = true
      ShellPayAuthActivity.start(ctx, amount)
      return
    }
    if (!BlypShellPayBootstrap.hasTransactionPin(ctx)) {
      ShellPinBootstrapActivity.startIfNeeded(ctx)
      return
    }
    showNoMerchant()
  }

  private fun showNoMerchant() {
    val ctx = context ?: return
    Toast.makeText(ctx, R.string.blyp_shell_pay_no_merchant, Toast.LENGTH_SHORT).show()
  }

  private fun showInsufficientBalanceDialog() {
    val ctx = context ?: return
    BlypShellDialogs.alertBuilder(ctx)
      .setTitle(R.string.blyp_shell_pay_insufficient_title)
      .setMessage(R.string.blyp_shell_pay_insufficient_message)
      .setNegativeButton(android.R.string.cancel, null)
      .setPositiveButton(R.string.blyp_shell_pay_top_up) { _, _ ->
        PayShellHandoff.openDeposit(ctx)
      }
      .show()
  }

  /** Le solde ne s’affiche plus sous les frais. */
  private fun bindBalance() {
    val ctx = context ?: return
    balanceView?.visibility = View.GONE
    val pending = BlypShellOfflinePayQueue.pendingCount(ctx)
    if (pending > 0) {
      balanceRowView?.visibility = View.VISIBLE
      balancePendingView?.visibility = View.VISIBLE
      balancePendingView?.text =
        resources.getQuantityString(R.plurals.blyp_shell_pay_pending_confirm, pending, pending)
    } else {
      balanceRowView?.visibility = View.GONE
      balancePendingView?.visibility = View.GONE
    }
  }

  private fun formatFcfa(amount: Int): String {
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    return NumberFormat.getIntegerInstance(locale).format(amount)
  }

  private fun withSmallF(text: String, ratio: Float): CharSequence {
    val s = android.text.SpannableString("${text}F")
    s.setSpan(
      android.text.style.RelativeSizeSpan(ratio),
      text.length,
      s.length,
      android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    return s
  }

  /** Frais Pay : 10 % sous 100 F, 10 F fixes à partir de 100 F (`lib/pay/fees.ts`). */
  private fun bindFee(amount: Int) {
    val v = feeView ?: return
    val fee =
      when {
        amount <= 0 -> 0
        amount >= 100 -> 10
        else -> Math.round(amount * 0.1f)
      }
    if (fee <= 0) {
      v.visibility = View.GONE
      return
    }
    v.visibility = View.VISIBLE
    v.text = withSmallF(getString(R.string.blyp_shell_pay_fee_line, formatFcfa(fee)), 10f / 12f)
  }

  /** Commerce (ou aucun destinataire) + détection coupée → l’en-tête montre « Bluetooth éteint ». */
  private fun shouldShowRadioOff(ctx: android.content.Context): Boolean {
    if (radioBlock(ctx) == RadioBlock.None) return false
    val id = BlypShellPayRuntime.activeRecipientAccountId(ctx)?.trim().orEmpty()
    return id.isEmpty() || BlypShellPayEligibility.isCommercePayAccountId(id)
  }

  private fun bindRadioOff(ctx: android.content.Context) {
    val location = radioBlock(ctx) == RadioBlock.Location
    recipientNameView?.setText(
      if (location) R.string.blyp_shell_location_off_title else R.string.blyp_shell_ble_off_title,
    )
    recipientNameView?.setTextColor(ctx.getColor(R.color.blyp_cold_start_text))
    recipientInitialView?.text = "?"
    recipientAvatarView?.visibility = View.GONE
    recipientInitialView?.visibility = View.VISIBLE
    recipientPhoneView?.visibility = View.VISIBLE
    recipientPhoneView?.setText(
      if (location) R.string.blyp_shell_location_off_hint else R.string.blyp_shell_ble_off_hint,
    )
    recipientPhoneView?.setOnClickListener(null)
    recipientPhoneView?.isClickable = false
    radioEnableView?.visibility = View.VISIBLE
  }

  /** Profil détecté : photo ronde, sans fond carré. */
  private var thumbDetected: Boolean? = null

  private fun setThumbDetected(detected: Boolean) {
    if (thumbDetected == detected) return
    thumbDetected = detected
    val thumb = view?.findViewById<View>(R.id.blyp_cold_recipient_thumb) ?: return
    if (detected) {
      thumb.setBackgroundResource(R.drawable.blyp_cold_avatar_round)
      thumb.outlineProvider =
        object : android.view.ViewOutlineProvider() {
          override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
            val w = view.width
            val h = view.height
            if (w <= 0 || h <= 0) return
            outline.setOval(0, 0, w, h)
          }
        }
      thumb.clipToOutline = true
    } else {
      thumb.clipToOutline = false
      thumb.outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
      thumb.setBackgroundResource(R.drawable.blyp_cold_avatar)
    }
  }

  private fun bindRecipient() {
    val ctx = context ?: return
    recipientRadioView?.visibility = View.GONE
    recipientSearchingView?.visibility = View.GONE
    radioOffShown = shouldShowRadioOff(ctx)
    if (radioOffShown) {
      setThumbDetected(false)
      bindRadioOff(ctx)
      return
    }
    radioEnableView?.visibility = View.GONE
    val label =
      BlypShellPayRuntime.activeRecipientLabel(ctx)
        ?: BlypShellPayRuntime.recipientLabel(ctx)
    val phoneRaw = BlypShellPayRuntime.activeRecipientPhone(ctx)
    if (BlypShellPayRuntime.activeRecipientFromQr(ctx)) {
      val id = BlypShellPayRuntime.activeRecipientAccountId(ctx)
      if (id != null) qrRecipientId = id
      if (qrCategory == null) {
        qrCategory = BlypShellPayQr.normalizeCategory(BlypShellPayRuntime.activeRecipientCategory(ctx))
      }
    }
    val qrActive =
      BlypShellPayRuntime.activeRecipientFromQr(ctx) ||
        (qrRecipientId != null &&
          qrRecipientId == BlypShellPayRuntime.activeRecipientAccountId(ctx))
    if (label.isNullOrBlank()) {
      setThumbDetected(false)
      val broadcasting =
        BlypShellTaxiBroadcast.snapshot(ctx).on && BlypShellSession.isCommerceMode(ctx)
      val searching = !broadcasting && isSearching()
      val refreshing = android.os.SystemClock.elapsedRealtime() < refreshingUntil
      recipientNameView?.setText(
        when {
          broadcasting -> R.string.blyp_shell_pay_broadcasting
          searching -> R.string.blyp_shell_pay_searching
          else -> R.string.blyp_shell_pay_none_nearby
        },
      )
      recipientNameView?.setTextColor(ctx.getColor(R.color.blyp_cold_start_text))
      recipientInitialView?.text = "?"
      recipientAvatarView?.visibility = View.GONE
      recipientInitialView?.visibility = if (broadcasting || searching) View.GONE else View.VISIBLE
      recipientRadioView?.visibility = if (broadcasting) View.VISIBLE else View.GONE
      recipientSearchingView?.visibility = if (searching) View.VISIBLE else View.GONE
      recipientPhoneView?.visibility = View.VISIBLE
      recipientPhoneView?.setText(
        when {
          broadcasting -> R.string.blyp_shell_pay_broadcasting_hint
          searching && refreshing -> R.string.blyp_shell_pay_refreshing_hint
          searching -> R.string.blyp_shell_pay_searching_hint
          else -> R.string.blyp_shell_pay_none_nearby_hint
        },
      )
      recipientPhoneView?.setOnClickListener(null)
      recipientPhoneView?.isClickable = false
      return
    }
    setThumbDetected(true)
    recipientNameView?.text = label.trim()
    recipientNameView?.setTextColor(ctx.getColor(R.color.blyp_cold_start_text))
    recipientNameView?.isSingleLine = true
    recipientNameView?.ellipsize = android.text.TextUtils.TruncateAt.END
    recipientInitialView?.text =
      label.trim().firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
    val initial = recipientInitialView?.text?.toString() ?: "?"
    val avatarUrl = BlypShellPeerAvatar.urlForPhone(ctx, phoneRaw)
    val avatarView = recipientAvatarView
    if (avatarView != null && !avatarUrl.isNullOrBlank()) {
      avatarView.outlineProvider =
        object : android.view.ViewOutlineProvider() {
          override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
            val w = view.width
            val h = view.height
            if (w <= 0 || h <= 0) return
            outline.setOval(0, 0, w, h)
          }
        }
      avatarView.clipToOutline = true
      BlypShellAvatarLoader.loadInto(avatarUrl, avatarView, recipientInitialView!!, initial)
    } else {
      avatarView?.visibility = View.GONE
      recipientInitialView?.visibility = View.VISIBLE
    }
    // Sous le nom : téléphone (QR `p=` ou BLE) sinon type commerce (QR `c=`).
    val cat =
      qrCategory
        ?: BlypShellPayQr.normalizeCategory(BlypShellPayRuntime.activeRecipientCategory(ctx))
    val catLabel = categoryLabel(cat)
    when {
      !phoneRaw.isNullOrBlank() -> {
        recipientPhoneView?.visibility = View.VISIBLE
        recipientPhoneView?.text = formatPhone(phoneRaw)
      }
      catLabel != null -> {
        recipientPhoneView?.visibility = View.VISIBLE
        recipientPhoneView?.text = catLabel
      }
      else -> recipientPhoneView?.visibility = View.GONE
    }
    recipientPhoneView?.setOnClickListener(null)
    recipientPhoneView?.isClickable = false
  }

  private fun categoryLabel(category: String?): String? {
    val ctx = context ?: return null
    return when (category?.trim()?.lowercase()) {
      "taxi" -> ctx.getString(R.string.blyp_shell_commerce_cat_taxi)
      "shop" -> ctx.getString(R.string.blyp_shell_commerce_cat_shop)
      "soa_car" -> ctx.getString(R.string.blyp_shell_commerce_cat_soa)
      "street" -> ctx.getString(R.string.blyp_shell_commerce_cat_street)
      "other" -> ctx.getString(R.string.blyp_shell_commerce_cat_other)
      else -> null
    }
  }

  private fun formatPhone(digits: String): String {
    val d = digits.replace(Regex("\\D"), "")
    if (d.length <= 3) return d
    if (d.length <= 6) return "${d.take(3)} ${d.drop(3)}"
    return "${d.take(3)} ${d.drop(3).take(3)} ${d.drop(6)}"
  }

  private fun bindKeypad(root: View) {
    val digitIds =
      intArrayOf(
        R.id.blyp_key_1,
        R.id.blyp_key_2,
        R.id.blyp_key_3,
        R.id.blyp_key_4,
        R.id.blyp_key_5,
        R.id.blyp_key_6,
        R.id.blyp_key_7,
        R.id.blyp_key_8,
        R.id.blyp_key_9,
        R.id.blyp_key_0,
      )
    val labels = arrayOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0")
    for (i in digitIds.indices) {
      root.findViewById<View>(digitIds[i])?.setOnClickListener {
        PayShellState.appendDigit(labels[i][0])
        PayOverlayUi.clearQuickSelection(root)
        refreshAmount()
      }
    }
    root.findViewById<View>(R.id.blyp_key_back)?.let { bindBackspace(root, it) }
    root.findViewById<View>(R.id.blyp_key_pay)?.setOnClickListener {
      attemptPay(PayShellState.queuePay())
    }
  }

  /** Effacement au doigt posé, puis en rafale tant que la touche est maintenue. */
  @android.annotation.SuppressLint("ClickableViewAccessibility")
  private fun bindBackspace(root: View, key: View) {
    val deleteOne = {
      PayShellState.backspace()
      PayOverlayUi.clearQuickSelection(root)
      refreshAmount()
    }
    var repeats = 0
    val repeat =
      object : Runnable {
        override fun run() {
          if (PayShellState.digitsString().isEmpty()) return
          deleteOne()
          repeats++
          mainHandler.postDelayed(this, if (repeats < 6) REPEAT_SLOW_MS else REPEAT_FAST_MS)
        }
      }
    backspaceRepeat = repeat
    key.setOnTouchListener { v, ev ->
      when (ev.actionMasked) {
        android.view.MotionEvent.ACTION_DOWN -> {
          v.isPressed = true
          repeats = 0
          deleteOne()
          mainHandler.postDelayed(repeat, REPEAT_START_MS)
        }
        android.view.MotionEvent.ACTION_UP -> {
          v.isPressed = false
          mainHandler.removeCallbacks(repeat)
          v.performClick()
        }
        android.view.MotionEvent.ACTION_CANCEL -> {
          v.isPressed = false
          mainHandler.removeCallbacks(repeat)
        }
      }
      true
    }
  }

  private fun stopBackspaceRepeat() {
    backspaceRepeat?.let { mainHandler.removeCallbacks(it) }
  }

  private fun refreshAmount() {
    amountView?.text = PayShellState.formatDisplay()
    val amount = PayShellState.amountFcfa()
    view?.let { PayOverlayUi.syncPayKey(it, amount) }
    bindFee(amount)
    warmDossierForCurrentAmount()
  }

  private fun warmDossierForCurrentAmount() {
    val ctx = context ?: return
    val amount = PayShellState.amountFcfa()
    if (amount <= 0) {
      BlypShellPayDossierRam.invalidate()
      return
    }
    BlypShellPayDossierRam.scheduleWarm(ctx, amount)
  }

  private companion object {
    const val SEARCH_PULSE_MS = 1_400L
    /** Signal BLE « collé » au téléphone : seul cas où il remplace un QR scanné. */
    const val QR_OVERRIDE_RSSI = -60
    const val REFRESH_DEBOUNCE_MS = 650L
    const val REFRESH_UI_MAX_MS = 1_600L
    const val REPEAT_START_MS = 380L
    const val REPEAT_SLOW_MS = 110L
    const val REPEAT_FAST_MS = 55L
  }
}
