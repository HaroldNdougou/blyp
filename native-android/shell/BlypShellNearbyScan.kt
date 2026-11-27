package com.haroldndougou.blyp.shell

import android.Manifest
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.cashiergatt.CashierGattPayerClient
import com.haroldndougou.blyp.cashiergatt.CashierGattUuids
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Pair Blyp le plus proche (RSSI) — calque de `lib/ble/scan.ts` + `selectPeer.ts`.
 * Tout tourne sur le fil principal (sélecteur non thread-safe, comme en JS).
 */
object BlypShellNearbyScan {
  private const val STALE_MS_NEAR = 18_000L
  private const val STALE_MS_FAR = 45_000L
  private const val STALE_RSSI_SPLIT = -82
  /** Écart RN (55 s) voulu : le dernier pair reste 5 min après son dernier signal, sauf pair plus fort. */
  private const val UI_HOLD_MS = 5 * 60_000L
  /** Un seul contrôle, rare : relancer souvent fait baisser la portée au bout de quelques minutes. */
  private const val SCAN_KICK_MS = 60_000L
  private const val SCAN_FROZEN_MS = 3 * 60_000L
  /** Android coupe en silence les résultats au-delà de 5 démarrages de scan en 30 s. */
  private const val START_WINDOW_MS = 30_000L
  private const val MAX_STARTS_PER_WINDOW = 4
  private const val MIN_RSSI = -110
  private const val RSSI_HYSTERESIS_DB = 3
  private const val RSSI_EMIT_DELTA_DB = 2
  private const val STALE_TICK_MS = 150L
  private val CASHIER_SERVICE = ParcelUuid(CashierGattUuids.SERVICE)

  data class Peer(
    val accountId: String,
    val phoneDigits: String,
    val displayName: String,
    val category: String?,
    val rssi: Int,
    val lastSeenAt: Long,
  )

  private val main = Handler(Looper.getMainLooper())
  private val startTimes = ArrayDeque<Long>()

  private fun canStartScan(): Boolean {
    val now = android.os.SystemClock.elapsedRealtime()
    while (startTimes.isNotEmpty() && now - startTimes.first() > START_WINDOW_MS) startTimes.removeFirst()
    return startTimes.size < MAX_STARTS_PER_WINDOW
  }

  @Volatile private var lastRawAt = 0L
  private var lastRestartAt = 0L

  private fun noteScanStarted() {
    val now = android.os.SystemClock.elapsedRealtime()
    startTimes.addLast(now)
    lastRawAt = now
  }

  @Volatile private var lastPacketAt = 0L

  private fun noteRaw() {
    val now = android.os.SystemClock.elapsedRealtime()
    lastRawAt = now
    lastPacketAt = now
  }
  private val listeners = CopyOnWriteArraySet<(Peer?) -> Unit>()
  private val peers = LinkedHashMap<String, Peer>()
  private var selectedId: String? = null
  private var bestPeer: Peer? = null
  private var lastValidPeer: Peer? = null
  private var lastValidPeerAt = 0L
  private var scanner: BluetoothLeScanner? = null
  private var scanning = false

  fun hasScanPermission(context: Context): Boolean {
    val perms =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
      } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
      }
    return perms.all {
      ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
  }

  fun scanPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  fun snapshot(): Peer? = bestPeer

  /** Refus d’un popup système → plus de demande auto pendant cette session (calque `markBleAutoPromptDeclined`). */
  @Volatile var locationPromptDeclined = false
  @Volatile var bluetoothPromptDeclined = false
  @Volatile private var silentEnableAt = 0L
  private const val SILENT_ENABLE_GRACE_MS = 4_000L

  fun resetSilentEnable() {
    silentEnableAt = 0L
  }

  /** Allumage sans popup lancé mais Bluetooth toujours éteint après le délai de démarrage. */
  fun silentEnableFailed(): Boolean =
    silentEnableAt > 0L && System.currentTimeMillis() - silentEnableAt > SILENT_ENABLE_GRACE_MS

  /** Localisation (permission + allumée) exigée par l’OS pour scanner jusqu’à Android 11. */
  fun needsLocation(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S

  fun isLocationOn(context: Context): Boolean {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager
      ?: return false
    return androidx.core.location.LocationManagerCompat.isLocationEnabled(lm)
  }

  /** Relance complète (ex. localisation tout juste allumée — l’OS ne livrait rien avant). */
  fun restart(context: Context) {
    val app = context.applicationContext
    main.post {
      if (scanning && !canStartScan()) {
        clearPeers()
        return@post
      }
      haltEngine()
      startOnMain(app)
    }
  }

  /** Oublie les pairs sans couper le scan (évite le blocage Android des redémarrages). */
  private fun clearPeers() {
    peers.clear()
    selectedId = null
    lastValidPeer = null
    lastValidPeerAt = 0L
    bestPeer = null
  }

  /** Comme `subscribeBleTaxiPeer` : rappel immédiat avec l’état courant. */
  fun subscribe(listener: (Peer?) -> Unit): () -> Unit {
    listeners.add(listener)
    main.post { listener(bestPeer) }
    return { listeners.remove(listener) }
  }

  @Volatile private var payWants = false
  @Volatile private var quickPayWants = false
  @Volatile private var chatWants = false

  /** Interrupteur « Bluetooth » du profil : coupe ou relance la détection tout de suite. */
  fun onBlePayPrefChanged(context: Context) {
    val app = context.applicationContext
    main.post {
      if (!BlypShellBlePayPref.isEnabled(app)) {
        haltEngine()
        emitPeer(null)
      } else if (payWants || quickPayWants || chatWants) {
        startOnMain(app)
      }
    }
  }

  fun startForChat(context: Context) {
    chatWants = true
    main.post { startOnMain(context.applicationContext) }
  }

  fun stopForChat() {
    chatWants = false
    main.post { if (!payWants && !quickPayWants && !chatWants) haltEngine() }
  }

  fun start(context: Context) {
    payWants = true
    main.post { startOnMain(context.applicationContext) }
  }

  fun startForQuickPay(context: Context) {
    quickPayWants = true
    main.post { startOnMain(context.applicationContext) }
  }

  fun stop() {
    payWants = false
    main.post { if (!payWants && !quickPayWants && !chatWants) haltEngine() }
  }

  fun stopForQuickPay() {
    quickPayWants = false
    main.post { if (!payWants && !quickPayWants && !chatWants) haltEngine() }
  }

  private fun startOnMain(context: Context) {
    if (!BlypShellBlePayPref.isEnabled(context)) return
    wanted = true
    retryContext = context.applicationContext
    ensureAdapterReceiver(context.applicationContext)
    if (scanning) return
    if (!hasScanPermission(context)) return
    val adapter =
      (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        ?: return
    if (!adapter.isEnabled) {
      if (silentEnableAt == 0L) silentEnableAt = System.currentTimeMillis()
      BlypShellBluetooth.ensureOnSilently(context)
      return
    }
    val sc = adapter.bluetoothLeScanner ?: return
    if (!canStartScan()) {
      main.removeCallbacks(retryStart)
      main.postDelayed(retryStart, 2_000L)
      return
    }
    try {
      sc.startScan(scanFilters(), scanSettings(), callback)
      noteScanStarted()
    } catch (_: SecurityException) {
      return
    } catch (_: IllegalStateException) {
      return
    }
    scanner = sc
    scanning = true
    if (com.haroldndougou.blyp.BuildConfig.DEBUG) android.util.Log.d("BlypNearby", "scan start")
    main.removeCallbacks(staleTick)
    main.postDelayed(staleTick, STALE_TICK_MS)
    main.removeCallbacks(kick)
    main.postDelayed(kick, SCAN_KICK_MS)
  }

  private fun scanSettings(): ScanSettings {
    val b =
      ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
        .setReportDelay(0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      b.setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
      b.setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
    }
    return b.build()
  }

  /** Filtre matériel : le téléphone continue d’entendre loin, même écran éteint. */
  private fun scanFilters(): List<ScanFilter> =
    listOf(
      ScanFilter.Builder()
        .setManufacturerData(BlypShellBlePayload.COMPANY_ID, ByteArray(0))
        .build(),
      ScanFilter.Builder().setServiceUuid(CASHIER_SERVICE).build(),
    )

  @Volatile private var wanted = false
  private var adapterReceiver: android.content.BroadcastReceiver? = null

  /**
   * Suit le Bluetooth tant que le scan est voulu : éteint → on arrête proprement (plus de pair),
   * rallumé (par nous ou par l’utilisateur) → le scan repart tout seul.
   */
  private fun ensureAdapterReceiver(app: Context) {
    if (adapterReceiver != null) return
    val r =
      object : android.content.BroadcastReceiver() {
        override fun onReceive(c: Context, intent: android.content.Intent) {
          val state =
            intent.getIntExtra(android.bluetooth.BluetoothAdapter.EXTRA_STATE, -1)
          when (state) {
            android.bluetooth.BluetoothAdapter.STATE_TURNING_OFF,
            android.bluetooth.BluetoothAdapter.STATE_OFF -> main.post { onAdapterGone() }
            android.bluetooth.BluetoothAdapter.STATE_ON -> {
              silentEnableAt = 0L
              main.post {
                if (!wanted) return@post
                if (scanning) {
                  /** Scanner d’avant l’extinction : on repart de zéro. */
                  scanning = false
                  scanner = null
                }
                startOnMain(app)
              }
            }
          }
        }
      }
    adapterReceiver = r
    ContextCompat.registerReceiver(
      app,
      r,
      android.content.IntentFilter(android.bluetooth.BluetoothAdapter.ACTION_STATE_CHANGED),
      ContextCompat.RECEIVER_EXPORTED,
    )
  }

  private fun onAdapterGone() {
    main.removeCallbacks(staleTick)
    main.removeCallbacks(kick)
    main.removeCallbacks(retryStart)
    scanning = false
    scanner = null
    val hadPeer = bestPeer != null
    peers.clear()
    selectedId = null
    lastValidPeer = null
    lastValidPeerAt = 0L
    if (hadPeer) emitPeer(null) else bestPeer = null
  }

  private fun unwatchAdapter(context: Context) {
    val r = adapterReceiver ?: return
    adapterReceiver = null
    runCatching { context.applicationContext.unregisterReceiver(r) }
  }

  private fun haltEngine() {
    wanted = false
    retryContext?.let { unwatchAdapter(it) }
    main.removeCallbacks(staleTick)
    main.removeCallbacks(kick)
    main.removeCallbacks(retryStart)
    if (scanning) {
      try {
        scanner?.stopScan(callback)
      } catch (_: Exception) {
      }
    }
    if (scanning && com.haroldndougou.blyp.BuildConfig.DEBUG) android.util.Log.d("BlypNearby", "scan stop")
    scanning = false
    scanner = null
    peers.clear()
    selectedId = null
    lastValidPeer = null
    lastValidPeerAt = 0L
    bestPeer = null
  }

  private val staleTick =
    object : Runnable {
      override fun run() {
        if (!scanning) return
        publishSelection(applyUiHold(resolve(System.currentTimeMillis())))
        main.postDelayed(this, STALE_TICK_MS)
      }
    }

  private var retryContext: Context? = null
  private val retryStart = Runnable { retryContext?.let { if (wanted) startOnMain(it) } }

  /** MIUI / OEM : le scan peut se figer sans erreur — relance sans perdre les pairs. */
  private val kick =
    object : Runnable {
      override fun run() {
        if (!scanning) return
        val sc = scanner
        val now = android.os.SystemClock.elapsedRealtime()
        val frozen = lastPacketAt != 0L && now - lastPacketAt > SCAN_FROZEN_MS
        val gapOk = now - lastRestartAt > SCAN_FROZEN_MS
        if (sc != null && frozen && gapOk && canStartScan()) {
          try {
            sc.stopScan(callback)
            sc.startScan(scanFilters(), scanSettings(), callback)
            noteScanStarted()
            lastRestartAt = now
          } catch (_: Exception) {
          }
        }
        main.postDelayed(this, SCAN_KICK_MS)
      }
    }

  private val callback =
    object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        noteRaw()
        main.post { onDevice(result) }
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        noteRaw()
        main.post { results.forEach { onDevice(it) } }
      }

      override fun onScanFailed(errorCode: Int) {
        if (com.haroldndougou.blyp.BuildConfig.DEBUG) {
          android.util.Log.d("BlypNearby", "scan FAILED code=$errorCode")
        }
        main.post {
          if (!scanning) return@post
          runCatching { scanner?.stopScan(this) }
          scanning = false
          scanner = null
          main.removeCallbacks(retryStart)
          main.postDelayed(retryStart, 2_000L)
        }
      }
    }

  private var dbgRaw = 0
  private var dbgBlyp = 0
  private var dbgBest = -999
  private var dbgAt = 0L

  private fun dbgTick(blyp: Boolean, rssi: Int) {
    if (!com.haroldndougou.blyp.BuildConfig.DEBUG) return
    dbgRaw++
    if (blyp) {
      dbgBlyp++
      if (rssi > dbgBest) dbgBest = rssi
    }
    val now = android.os.SystemClock.elapsedRealtime()
    if (now - dbgAt < 2_000L) return
    android.util.Log.d(
      "BlypNearby",
      "2s: ble=$dbgRaw blyp=$dbgBlyp bestRssi=$dbgBest shown=${bestPeer?.accountId?.takeLast(4)}",
    )
    dbgAt = now
    dbgRaw = 0
    dbgBlyp = 0
    dbgBest = -999
  }

  private fun onDevice(result: ScanResult) {
    if (!scanning) return
    val record = result.scanRecord ?: return dbgTick(false, 0)
    val parsed =
      BlypShellBlePayload.decodeFromScan(
        localName = record.deviceName,
        manufBytes = record.getManufacturerSpecificData(BlypShellBlePayload.COMPANY_ID),
        rawRecord = record.bytes,
        rssi = result.rssi,
      ) ?: return dbgTick(false, 0)
    dbgTick(true, result.rssi)
    if (record.serviceUuids?.contains(CASHIER_SERVICE) == true) {
      CashierGattPayerClient.noteCashierSeen(parsed.accountId, result.device)
    }
    val now = System.currentTimeMillis()
    val sighting =
      Peer(
        accountId = parsed.accountId,
        phoneDigits = parsed.phoneDigits,
        displayName = parsed.displayName,
        category = parsed.category,
        rssi = parsed.rssi,
        lastSeenAt = now,
      )
    if (sighting.rssi >= MIN_RSSI && lastValidPeer?.accountId == sighting.accountId) {
      lastValidPeerAt = now
    }
    publishSelection(applyUiHold(noteSighting(sighting)))
  }

  private fun staleMsFor(p: Peer): Long =
    if (p.rssi >= STALE_RSSI_SPLIT) STALE_MS_NEAR else STALE_MS_FAR

  private fun noteSighting(peer: Peer): Peer? {
    if (peer.rssi < MIN_RSSI) return resolve(System.currentTimeMillis())
    val prev = peers[peer.accountId]
    /** 1ère vue = RSSI brut ; ensuite moyenne glissante, moins lissée en signal faible. */
    val blend = if (peer.rssi < -82) 0.45 else 0.8
    val rssi =
      if (prev != null) Math.round(prev.rssi * (1 - blend) + peer.rssi * blend).toInt()
      else peer.rssi
    peers[peer.accountId] = peer.copy(rssi = rssi)
    return resolve(System.currentTimeMillis())
  }

  private fun resolve(now: Long): Peer? {
    val it = peers.entries.iterator()
    while (it.hasNext()) {
      val p = it.next().value
      if (now - p.lastSeenAt > staleMsFor(p)) it.remove()
    }
    if (selectedId != null && !peers.containsKey(selectedId)) selectedId = null

    var top: Peer? = null
    for (p in peers.values) {
      if (now - p.lastSeenAt > staleMsFor(p)) continue
      if (p.rssi < MIN_RSSI) continue
      if (top == null || p.rssi > top.rssi) top = p
    }
    val current = selectedId?.let { peers[it] }
    val currentFresh =
      if (current != null && now - current.lastSeenAt <= staleMsFor(current)) current else null

    if (top == null) {
      selectedId = null
      return null
    }
    if (currentFresh == null) {
      selectedId = top.accountId
      return top
    }
    if (top.accountId == currentFresh.accountId) return currentFresh
    if (top.rssi >= currentFresh.rssi + RSSI_HYSTERESIS_DB) {
      selectedId = top.accountId
      return top
    }
    return currentFresh
  }

  /** Garde le dernier pair [UI_HOLD_MS] ; un autre ne le remplace que s’il est plus fort. */
  private fun applyUiHold(next: Peer?): Peer? {
    if (!scanning) return next
    val now = System.currentTimeMillis()
    val held = lastValidPeer?.takeIf { now - lastValidPeerAt <= UI_HOLD_MS }
    if (held == null) {
      lastValidPeer = next
      if (next != null) lastValidPeerAt = now
      return next
    }
    if (next == null) return held
    if (next.accountId == held.accountId) {
      lastValidPeer = next
      return next
    }
    if (next.rssi >= held.rssi + RSSI_HYSTERESIS_DB) {
      lastValidPeer = next
      lastValidPeerAt = now
      return next
    }
    return held
  }

  /** Publie dès le 1er pair ; ensuite seulement si pair / RSSI change assez. */
  private fun publishSelection(next: Peer?) {
    val prev = bestPeer
    if (prev == null && next == null) return
    if (prev == null && next != null) {
      emitPeer(next)
      return
    }
    if (prev != null && next != null && prev.accountId == next.accountId &&
      Math.abs(prev.rssi - next.rssi) < RSSI_EMIT_DELTA_DB
    ) {
      bestPeer = next
      return
    }
    emitPeer(next)
  }

  private fun emitPeer(peer: Peer?) {
    bestPeer = peer
    for (l in listeners) runCatching { l(peer) }
  }
}
