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

  @Volatile
  private var running = false

  fun isRunning(): Boolean = running

  fun start(context: Context, session: Int, merchantAccountId: String): Boolean {
    stop(context)
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

    advertiser?.startAdvertising(settings, data, advertiseCallback)
    running = true
    return true
  }

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
      override fun onStartFailure(errorCode: Int) {
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
        val json = String(value, StandardCharsets.UTF_8)
        CashierGattBridge.emitReceipt(json)
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
    }
}
