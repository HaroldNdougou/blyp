package com.haroldndougou.blyp.shell

import android.Manifest
import android.app.Activity
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.bleforeground.BleBroadcastForegroundBridge
import com.haroldndougou.blyp.bleforeground.BleBroadcastForegroundService
import com.haroldndougou.blyp.cashiergatt.CashierGattController
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/** Diffusion BLE « En ligne » pour la coque commerce (sans React). */
object BlypShellTaxiBroadcast {
  private const val PREFS = "blyp_shell_taxi_broadcast"
  private const val KEY_WANT_ON = "want_on"
  private const val SERVICE_UUID = "b1b70001-b1b7-4111-8000-00805f9b34fb"
  private const val COMPANY_ID = 0x0b1b

  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<() -> Unit>()

  @Volatile private var wantOn = false
  @Volatile private var on = false
  @Volatile private var busy = false
  @Volatile private var appContext: Context? = null
  @Volatile private var retryAttempt = 0
  @Volatile private var advertiser: BluetoothLeAdvertiser? = null
  @Volatile private var advertiseCallback: AdvertiseCallback? = null
  @Volatile private var stopBridgeRegistered = false
  @Volatile private var lifecycleRegistered = false
  /** App au premier plan : diffusion perso coupée, le scan Payer tourne. */
  @Volatile private var pausedInApp = false
  @Volatile private var startedActivities = 0

  data class Snapshot(
    val on: Boolean,
    val wantOn: Boolean,
    val busy: Boolean,
  ) {
    val interrupted: Boolean get() = wantOn && !on
  }

  fun subscribe(listener: () -> Unit): () -> Unit {
    listeners.add(listener)
    listener()
    return { listeners.remove(listener) }
  }

  fun snapshot(context: Context): Snapshot {
    loadWantOn(context)
    return Snapshot(on = on, wantOn = wantOn, busy = busy)
  }

  fun attachShell(context: Context) {
    val app = context.applicationContext
    loadWantOn(app)
    if (!stopBridgeRegistered) {
      stopBridgeRegistered = true
      BleBroadcastForegroundBridge.registerShellStopListener {
        setWantOn(app, false, fromNotification = true)
      }
    }
    registerAppLifecycle(app)
    if (wantOn && BlypShellSession.isCommerceMode(app)) {
      io.execute { startInternal(app, forcePrompt = false) }
    } else {
      onAppForeground(app)
    }
  }

  fun stopImmediately(context: Context) {
    setWantOn(context, false)
    BlypShellClosedCashier.stop(context.applicationContext)
  }

  fun setWantOn(context: Context, enabled: Boolean, fromNotification: Boolean = false) {
    val app = context.applicationContext
    wantOn = enabled
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_WANT_ON, enabled).apply()
    emit()
    if (enabled) {
      io.execute { startInternal(app, forcePrompt = !fromNotification) }
    } else {
      io.execute { stopInternal(app) }
    }
  }

  fun toggle(context: Context) {
    setWantOn(context, !wantOn)
  }

  fun hasAdvertisePermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.BLUETOOTH_ADVERTISE,
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun loadWantOn(context: Context) {
    wantOn =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getBoolean(KEY_WANT_ON, false)
  }

  private fun emit() {
    main.post {
      for (fn in listeners) {
        runCatching { fn() }
      }
    }
  }

  private fun registerAppLifecycle(context: Context) {
    if (lifecycleRegistered) return
    val application = context.applicationContext as? Application ?: return
    lifecycleRegistered = true
    application.registerActivityLifecycleCallbacks(
      object : Application.ActivityLifecycleCallbacks {
        override fun onActivityStarted(activity: Activity) {
          startedActivities++
          if (startedActivities == 1) onAppForeground(application)
        }

        override fun onActivityStopped(activity: Activity) {
          startedActivities = (startedActivities - 1).coerceAtLeast(0)
          if (startedActivities == 0) onAppBackground(application)
        }

        override fun onActivityCreated(a: Activity, b: Bundle?) {}
        override fun onActivityResumed(a: Activity) {}
        override fun onActivityPaused(a: Activity) {}
        override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
      },
    )
    startedActivities = startedActivities.coerceAtLeast(1)
  }

  private fun onAppForeground(context: Context) {
    val app = context.applicationContext
    if (BlypShellSession.isCommerceMode(app)) {
      pausedInApp = false
      return
    }
    pausedInApp = false
    if (!wantOn) return
    io.execute { startInternal(app, forcePrompt = false) }
  }

  private fun onAppBackground(context: Context) {
    val app = context.applicationContext
    pausedInApp = false
    if (!wantOn || BlypShellSession.isCommerceMode(app)) return
    io.execute { startInternal(app, forcePrompt = false) }
  }

  private fun startInternal(context: Context, forcePrompt: Boolean) {
    if (!wantOn) return
    if (busy) return
    busy = true
    emit()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasAdvertisePermission(context)) {
        on = false
        return
      }
      val account = BlypShellBleAccount.resolveForBroadcast(context) ?: run {
        on = false
        return
      }
      val manuf =
        BlypShellBlePayload.encodeManufBytes(
          account.accountId,
          account.phone,
          account.category,
        ) ?: run {
          on = false
          return
        }
      val adapter =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
      if (adapter != null && !adapter.isEnabled && BlypShellBluetooth.canEnableSilently()) {
        BlypShellBluetooth.ensureOnSilently(context)
        var waited = 0L
        while (!adapter.isEnabled && waited < 4_000L) {
          Thread.sleep(150L)
          waited += 150L
        }
      }
      if (adapter == null || !adapter.isEnabled) {
        on = false
        return
      }
      stopAdvertisingQuietly()
      val commerce = BlypShellSession.isCommerceMode(context)
      if (commerce) {
        if (!CashierGattController.isRunning()) {
          BlypShellClosedCashier.ensureRunning(context, fromBroadcast = true)
        }
        if (CashierGattController.isRunning()) {
          CashierGattController.setIdentity(manuf)
          on = true
          startForegroundNotif(context)
          return
        }
      }
      if (!commerce) {
        if (!CashierGattController.isRunning()) {
          BlypShellClosedCashier.ensureRunning(context, fromBroadcast = true)
        }
        if (CashierGattController.isRunning()) {
          CashierGattController.setIdentity(manuf)
          on = true
          startForegroundNotif(context)
          return
        }
      }
      val adv = adapter.bluetoothLeAdvertiser
      if (adv == null) {
        on = false
        return
      }
      val settings =
        AdvertiseSettings.Builder()
          .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
          .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
          .setConnectable(false)
          .setTimeout(0)
          .build()
      val scanResponse =
        AdvertiseData.Builder()
          .setIncludeDeviceName(false)
          .setIncludeTxPowerLevel(false)
          .addManufacturerData(COMPANY_ID, manuf)
          .build()
      val data =
        AdvertiseData.Builder()
          .setIncludeDeviceName(false)
          .setIncludeTxPowerLevel(false)
          .addManufacturerData(COMPANY_ID, manuf)
          .build()
      val latch = Object()
      var started = false
      val callback =
        object : AdvertiseCallback() {
          override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            synchronized(latch) {
              started = true
              latch.notifyAll()
            }
          }

          override fun onStartFailure(errorCode: Int) {
            synchronized(latch) {
              started = false
              latch.notifyAll()
            }
          }
        }
      adv.startAdvertising(settings, data, scanResponse, callback)
      synchronized(latch) {
        if (!started) {
          latch.wait(8_000)
        }
      }
      if (!started) {
        try {
          adv.stopAdvertising(callback)
        } catch (_: Exception) {
        }
        on = false
        return
      }
      advertiser = adv
      advertiseCallback = callback
      on = true
      startForegroundNotif(context)
    } finally {
      busy = false
      emit()
    }
  }

  private fun startForegroundNotif(context: Context) {
    main.post {
      BleBroadcastForegroundService.start(
        context,
        context.getString(R.string.blyp_shell_commerce_online_notif_title),
        context.getString(R.string.blyp_shell_commerce_online_notif_body),
        context.getString(R.string.blyp_shell_commerce_online_notif_stop),
      )
    }
  }

  /** Caisse démarrée / arrêtée : un seul signal — celui de la caisse s’il tourne, sinon le nôtre. */
  fun reapply(context: Context) {
    val app = context.applicationContext
    loadWantOn(app)
    if (!wantOn) return
    io.execute { startInternal(app, forcePrompt = false) }
  }

  private fun stopInternal(context: Context) {
    busy = true
    emit()
    try {
      stopAdvertisingQuietly()
      if (CashierGattController.isRunning()) {
        CashierGattController.setIdentity(null)
      }
      BlypShellClosedCashier.onBroadcastOff(context)
      on = false
      BleBroadcastForegroundService.stop(context.applicationContext)
    } finally {
      busy = false
      emit()
    }
  }

  private fun stopAdvertisingQuietly() {
    val adv = advertiser
    val cb = advertiseCallback
    if (adv != null && cb != null) {
      try {
        adv.stopAdvertising(cb)
      } catch (_: Exception) {
      }
    }
    advertiser = null
    advertiseCallback = null
  }
}
