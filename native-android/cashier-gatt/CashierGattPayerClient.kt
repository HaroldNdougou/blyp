package com.haroldndougou.blyp.cashiergatt

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Payeur → caisse fermée. Pendant la saisie du montant, la liaison avec la caisse est ouverte
 * et gardée ; au paiement il ne reste qu’une écriture sur la liaison déjà prête.
 */
object CashierGattPayerClient {
  private const val SCAN_MAX_MS = 6_000L
  /** Après le 1er appareil vu, on laisse ce délai aux autres caisses proches pour répondre. */
  private const val SCAN_SETTLE_MS = 400L
  private const val GATT_MS = 6_000L
  private const val WRITE_MS = 3_000L
  private const val MAX_CANDIDATES = 4
  private const val CACHE_TTL_MS = 5 * 60_000L
  /** Liaison libérée après ce délai sans usage (la caisse a un nombre de places limité). */
  private const val LINK_IDLE_MS = 60_000L
  private const val WANTED_MTU = 517

  private data class Known(val address: String, val session: Int, val atMs: Long)

  private val known = ConcurrentHashMap<String, Known>()
  private val seen = ConcurrentHashMap<String, BluetoothDevice>()
  private val lock = Any()
  private val idleTimer = Executors.newSingleThreadScheduledExecutor()

  @Volatile private var link: Link? = null
  @Volatile private var idleClose: ScheduledFuture<*>? = null

  fun cachedSession(merchantAccountId: String): Int? {
    val target = merchantAccountId.trim().uppercase()
    liveLink(target)?.let { return it.session }
    val k = known[target] ?: return null
    if (System.currentTimeMillis() - k.atMs > CACHE_TTL_MS) return null
    return k.session
  }

  /** Caisse vue pendant la détection du commerce (même téléphone, même signal). */
  fun noteCashierSeen(merchantAccountId: String, device: BluetoothDevice) {
    val target = merchantAccountId.trim().uppercase()
    if (target.isEmpty()) return
    seen[target] = device
  }

  fun forget(merchantAccountId: String) {
    val target = merchantAccountId.trim().uppercase()
    known.remove(target)
    synchronized(lock) {
      if (link?.target == target) dropLink()
    }
  }

  /** Repérage en amont : ouvre et garde la liaison avec la caisse du commerçant. */
  fun prefetchMerchantSync(context: Context, merchantAccountId: String): Int? {
    val target = merchantAccountId.trim().uppercase()
    if (target.isEmpty()) return null
    synchronized(lock) {
      return ensureLink(context, target)?.session
    }
  }

  fun readCashierSessionSync(context: Context, merchantAccountId: String): Int? =
    prefetchMerchantSync(context, merchantAccountId)

  /**
   * Écrit le message construit avec la session caisse, sur la liaison déjà ouverte si possible.
   * Retourne la session utilisée (null si caisse introuvable ou écriture refusée).
   */
  fun deliverWithSessionSync(
    context: Context,
    merchantAccountId: String,
    buildPayload: (session: Int) -> String?,
  ): Int? {
    val target = merchantAccountId.trim().uppercase()
    if (target.isEmpty()) return null
    synchronized(lock) {
      repeat(2) {
        val l = ensureLink(context, target) ?: return null
        val payload = buildPayload(l.session)?.trim()
        if (payload.isNullOrEmpty()) return null
        if (l.write(payload)) {
          touch(l)
          return l.session
        }
        dropLink()
        known.remove(target)
      }
      return null
    }
  }

  fun deliverPayloadSync(
    context: Context,
    merchantAccountId: String,
    payloadJson: String,
  ): Boolean {
    val payload = payloadJson.trim()
    if (payload.isEmpty()) return false
    return deliverWithSessionSync(context, merchantAccountId) { payload } != null
  }

  private fun liveLink(target: String): Link? {
    val l = link ?: return null
    return if (l.target == target && l.isReady()) l else null
  }

  /** Doit être appelé sous [lock]. */
  private fun ensureLink(context: Context, target: String): Link? {
    liveLink(target)?.let {
      touch(it)
      return it
    }
    dropLink()
    seen[target]?.let { dev ->
      val l = Link.open(context, dev, target)
      if (l != null) return adopt(l)
      seen.remove(target)
    }
    known[target]?.let { k ->
      val dev = remoteDevice(k.address)
      if (dev != null) {
        val l = Link.open(context, dev, target)
        if (l != null) return adopt(l)
      }
      known.remove(target)
    }
    for (dev in scanCandidates(context)) {
      val l = Link.open(context, dev, target) ?: continue
      return adopt(l)
    }
    return null
  }

  private fun adopt(l: Link): Link {
    link = l
    known[l.target] = Known(l.address, l.session, System.currentTimeMillis())
    touch(l)
    return l
  }

  private fun touch(l: Link) {
    known[l.target] = Known(l.address, l.session, System.currentTimeMillis())
    idleClose?.cancel(false)
    idleClose =
      idleTimer.schedule(
        {
          synchronized(lock) {
            if (link === l) dropLink()
          }
        },
        LINK_IDLE_MS,
        TimeUnit.MILLISECONDS,
      )
  }

  private fun dropLink() {
    idleClose?.cancel(false)
    idleClose = null
    link?.close()
    link = null
  }

  private fun remoteDevice(address: String): BluetoothDevice? {
    val adapter = BluetoothAdapter.getDefaultAdapter() ?: return null
    if (!adapter.isEnabled) return null
    return runCatching { adapter.getRemoteDevice(address) }.getOrNull()
  }

  private fun scanCandidates(context: Context): List<BluetoothDevice> {
    val adapter = BluetoothAdapter.getDefaultAdapter() ?: return emptyList()
    if (!adapter.isEnabled) return emptyList()
    val scanner = adapter.bluetoothLeScanner ?: return emptyList()
    val found = ConcurrentHashMap<String, Pair<BluetoothDevice, Int>>()
    val firstHit = CountDownLatch(1)
    val callback =
      object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
          val dev = result.device ?: return
          found[dev.address] = dev to result.rssi
          firstHit.countDown()
        }

        override fun onScanFailed(errorCode: Int) {
          firstHit.countDown()
        }
      }
    val filter =
      ScanFilter.Builder()
        .setServiceUuid(ParcelUuid(CashierGattUuids.SERVICE))
        .build()
    val settings =
      ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .build()
    try {
      scanner.startScan(listOf(filter), settings, callback)
      if (firstHit.await(SCAN_MAX_MS, TimeUnit.MILLISECONDS) && found.isNotEmpty()) {
        Thread.sleep(SCAN_SETTLE_MS)
      }
    } catch (_: SecurityException) {
      return emptyList()
    } finally {
      try {
        scanner.stopScan(callback)
      } catch (_: Exception) {
      }
    }
    return found.values
      .sortedByDescending { it.second }
      .take(MAX_CANDIDATES)
      .map { it.first }
  }

  private fun parseSessionPayload(bytes: ByteArray): Pair<Int, String>? {
    if (bytes.size < 4) return null
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val sessionId = buf.int
    val accBytes = bytes.copyOfRange(4, minOf(bytes.size, 4 + 48))
    val acc =
      accBytes.takeWhile { it != 0.toByte() }
        .toByteArray()
        .toString(StandardCharsets.UTF_8)
        .trim()
        .uppercase()
    if (!acc.startsWith("BLYP-C-")) return null
    return sessionId to acc
  }

  /** Liaison ouverte avec une caisse : connectée, session lue, prête à recevoir. */
  private class Link private constructor(val target: String, val address: String) :
    BluetoothGattCallback() {
    @Volatile private var gatt: BluetoothGatt? = null
    @Volatile private var ready = false
    @Volatile private var closed = false
    @Volatile var session: Int = 0
      private set
    private val readyLatch = CountDownLatch(1)
    @Volatile private var writeLatch: CountDownLatch? = null
    @Volatile private var wrote = false

    fun isReady(): Boolean = ready && !closed

    fun write(payload: String): Boolean {
      val g = gatt ?: return false
      if (!isReady()) return false
      val ch =
        g.getService(CashierGattUuids.SERVICE)?.getCharacteristic(CashierGattUuids.RECEIPT)
          ?: return false
      val latch = CountDownLatch(1)
      wrote = false
      writeLatch = latch
      return try {
        ch.value = payload.toByteArray(StandardCharsets.UTF_8)
        ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        if (!g.writeCharacteristic(ch)) return false
        latch.await(WRITE_MS, TimeUnit.MILLISECONDS) && wrote
      } catch (_: SecurityException) {
        false
      } finally {
        writeLatch = null
      }
    }

    fun close() {
      closed = true
      ready = false
      readyLatch.countDown()
      writeLatch?.countDown()
      try {
        gatt?.disconnect()
        gatt?.close()
      } catch (_: Exception) {
      }
      gatt = null
    }

    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothGatt.STATE_CONNECTED) {
        val asked = runCatching { g.requestMtu(WANTED_MTU) }.getOrDefault(false)
        if (!asked) g.discoverServices()
      } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
        close()
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
      g.discoverServices()
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val ch =
        g.getService(CashierGattUuids.SERVICE)?.getCharacteristic(CashierGattUuids.SESSION)
      if (status != BluetoothGatt.GATT_SUCCESS || ch == null || !g.readCharacteristic(ch)) {
        close()
      }
    }

    override fun onCharacteristicRead(
      g: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      if (characteristic.uuid != CashierGattUuids.SESSION) return
      val parsed =
        if (status == BluetoothGatt.GATT_SUCCESS) {
          parseSessionPayload(characteristic.value ?: byteArrayOf())
        } else {
          null
        }
      if (parsed == null || parsed.second != target) {
        close()
        return
      }
      session = parsed.first
      ready = true
      readyLatch.countDown()
    }

    override fun onCharacteristicWrite(
      g: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      if (characteristic.uuid != CashierGattUuids.RECEIPT) return
      wrote = status == BluetoothGatt.GATT_SUCCESS
      writeLatch?.countDown()
    }

    companion object {
      fun open(context: Context, device: BluetoothDevice, target: String): Link? {
        val l = Link(target, device.address)
        try {
          l.gatt =
            device.connectGatt(
              context.applicationContext,
              false,
              l,
              BluetoothDevice.TRANSPORT_LE,
            )
          if (l.gatt == null) return null
          l.readyLatch.await(GATT_MS, TimeUnit.MILLISECONDS)
        } catch (_: SecurityException) {
          l.close()
          return null
        }
        if (!l.isReady()) {
          l.close()
          return null
        }
        return l
      }
    }
  }
}
