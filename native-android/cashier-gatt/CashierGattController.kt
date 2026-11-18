package com.haroldndougou.blyp.cashiergatt

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.os.ParcelUuid
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets

/**
 * Serveur GATT caisse fermée — le payeur se connecte et écrit la preuve (pas de broadcast ouvert).
 */
object CashierGattController {
  private var gattServer: android.bluetooth.BluetoothGattServer? = null
  private var advertiser: android.bluetooth.le.BluetoothLeAdvertiser? = null
  private var sessionId: Int = 0
  private var accountId: String = ""
  private var sessionPayload: ByteArray = byteArrayOf()
  private var appContext: Context? = null
  private val pendingWrites =
    java.util.concurrent.ConcurrentHashMap<String, java.io.ByteArrayOutputStream>()

  @Volatile
  private var running = false

  fun isRunning(): Boolean = running

  fun merchantSessionId(): Int = sessionId

  fun merchantAccountId(): String = accountId

  /** Identité commerce (mêmes octets que la diffusion « En ligne ») en réponse de scan. */
  private var identityManuf: ByteArray? = null

  fun start(
    context: Context,
    session: Int,
    merchantAccountId: String,
    identityManufBytes: ByteArray? = null,
  ): Boolean {
    stop(context)
    identityManuf = identityManufBytes
    appContext = context.applicationContext
    val adapter = BluetoothAdapter.getDefaultAdapter() ?: return false
    if (!adapter.isEnabled) return false
    sessionId = session
    accountId = merchantAccountId.trim().uppercase()
    sessionPayload = buildSessionPayload(sessionId, accountId)

    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    gattServer =
      manager.openGattServer(context.applicationContext, gattCallback)
        ?: return false

    val service =
      BluetoothGattService(
        CashierGattUuids.SERVICE,
        BluetoothGattService.SERVICE_TYPE_PRIMARY,
      )
    val sessionChar =
      BluetoothGattCharacteristic(
        CashierGattUuids.SESSION,
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ,
      )
    sessionChar.value = sessionPayload
    val cccd =
      BluetoothGattDescriptor(
        UUID_CCCD,
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
      )
    sessionChar.addDescriptor(cccd)

    val receiptChar =
      BluetoothGattCharacteristic(
        CashierGattUuids.RECEIPT,
        BluetoothGattCharacteristic.PROPERTY_WRITE or
          BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
        BluetoothGattCharacteristic.PERMISSION_WRITE,
      )

    service.addCharacteristic(sessionChar)
    service.addCharacteristic(receiptChar)
    gattServer?.addService(service)

    advertiser = adapter.bluetoothLeAdvertiser
    if (advertiser == null) {
      stop(context)
      return false
    }

    startAdvertisingInternal()
    running = true
    return true
  }

  private fun startAdvertisingInternal() {
    val settings =
      AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setConnectable(true)
        .setTimeout(0)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .build()

    val data =
      AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .setIncludeTxPowerLevel(false)
        .addServiceUuid(ParcelUuid(CashierGattUuids.SERVICE))
        .build()

    val manuf = identityManuf
    try {
      if (manuf != null) {
        /** Identité dans le paquet principal : la réponse de scan se perd vite avec la distance. */
        val primary =
          AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(IDENTITY_COMPANY_ID, manuf)
            .build()
        advertiser?.startAdvertising(settings, primary, data, advertiseCallback)
      } else {
        advertiser?.startAdvertising(settings, data, advertiseCallback)
      }
    } catch (_: SecurityException) {
    }
  }

  /** Ajoute / retire l’identité commerce du signal caisse (« En ligne » on / off). */
  fun setIdentity(identityManufBytes: ByteArray?) {
    val prev = identityManuf
    if (prev == null && identityManufBytes == null) return
    if (prev != null && identityManufBytes != null && prev.contentEquals(identityManufBytes)) return
    identityManuf = identityManufBytes
    restartAdvertising()
  }

  /** Certains appareils coupent la pub connectable à la 1re liaison : on la relance. */
  private fun restartAdvertising() {
    if (!running) return
    try {
      advertiser?.stopAdvertising(advertiseCallback)
    } catch (_: Exception) {
    }
    startAdvertisingInternal()
  }

  private const val IDENTITY_COMPANY_ID = 0x0b1b

  fun stop(context: Context) {
    running = false
    try {
      advertiser?.stopAdvertising(advertiseCallback)
    } catch (_: Exception) {
    }
    advertiser = null
    try {
      gattServer?.close()
    } catch (_: Exception) {
    }
    gattServer = null
  }

  private val UUID_CCCD: java.util.UUID =
    java.util.UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

  private fun buildSessionPayload(session: Int, account: String): ByteArray {
    val acc = account.toByteArray(StandardCharsets.UTF_8).copyOf(48)
    val buf = ByteBuffer.allocate(4 + 48).order(ByteOrder.LITTLE_ENDIAN)
    buf.putInt(session)
    buf.put(acc)
    return buf.array()
  }

  private val advertiseCallback =
    object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
        android.util.Log.d("BlypCashierAdv", "adv ok identity=${identityManuf?.size ?: 0}b")
      }

      override fun onStartFailure(errorCode: Int) {
        android.util.Log.d("BlypCashierAdv", "adv FAILED code=$errorCode identity=${identityManuf?.size ?: 0}b")
        CashierGattBridge.emitError("advertise_failed_$errorCode")
      }
    }

  private val gattCallback =
    object : android.bluetooth.BluetoothGattServerCallback() {
      override fun onCharacteristicReadRequest(
        device: android.bluetooth.BluetoothDevice,
        requestId: Int,
        offset: Int,
        characteristic: BluetoothGattCharacteristic,
      ) {
        if (characteristic.uuid != CashierGattUuids.SESSION) {
          gattServer?.sendResponse(
            device,
            requestId,
            android.bluetooth.BluetoothGatt.GATT_FAILURE,
            offset,
            null,
          )
          return
        }
        val full = sessionPayload
        val slice =
          if (offset >= full.size) byteArrayOf()
          else full.copyOfRange(offset, full.size)
        gattServer?.sendResponse(
          device,
          requestId,
          android.bluetooth.BluetoothGatt.GATT_SUCCESS,
          offset,
          slice,
        )
      }

      override fun onCharacteristicWriteRequest(
        device: android.bluetooth.BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) {
        if (characteristic.uuid != CashierGattUuids.RECEIPT) {
          if (responseNeeded) {
            gattServer?.sendResponse(
              device,
              requestId,
              android.bluetooth.BluetoothGatt.GATT_FAILURE,
              offset,
              null,
            )
          }
          return
        }
        if (preparedWrite) {
          val buf = pendingWrites.getOrPut(device.address) { java.io.ByteArrayOutputStream() }
          synchronized(buf) {
            if (offset == 0) buf.reset()
            buf.write(value)
          }
        } else {
          CashierGattBridge.emitReceipt(String(value, StandardCharsets.UTF_8))
        }
        if (responseNeeded) {
          gattServer?.sendResponse(
            device,
            requestId,
            android.bluetooth.BluetoothGatt.GATT_SUCCESS,
            offset,
            value,
          )
        }
      }

      override fun onExecuteWrite(
        device: android.bluetooth.BluetoothDevice,
        requestId: Int,
        execute: Boolean,
      ) {
        val buf = pendingWrites.remove(device.address)
        if (execute && buf != null) {
          val bytes = synchronized(buf) { buf.toByteArray() }
          CashierGattBridge.emitReceipt(String(bytes, StandardCharsets.UTF_8))
        }
        gattServer?.sendResponse(
          device,
          requestId,
          android.bluetooth.BluetoothGatt.GATT_SUCCESS,
          0,
          null,
        )
      }

      override fun onConnectionStateChange(
        device: android.bluetooth.BluetoothDevice,
        status: Int,
        newState: Int,
      ) {
        if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
          pendingWrites.remove(device.address)
        } else if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
          restartAdvertising()
        }
      }
    }
}
