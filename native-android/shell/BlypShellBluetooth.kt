package com.haroldndougou.blyp.shell

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Bluetooth allumé sans popup quand l’OS le permet (Android 12 et avant). */
object BlypShellBluetooth {
  fun adapter(context: Context): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  fun isOn(context: Context): Boolean = adapter(context)?.isEnabled == true

  /** Android 13+ interdit l’allumage par l’app : popup système obligatoire. */
  fun canEnableSilently(): Boolean = Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2

  /** true si déjà allumé ; sinon lance l’allumage silencieux si possible (asynchrone côté OS). */
  @Suppress("DEPRECATION")
  fun ensureOnSilently(context: Context): Boolean {
    val a = adapter(context) ?: return false
    if (a.isEnabled) return true
    if (!canEnableSilently()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    try {
      a.enable()
    } catch (_: SecurityException) {
    }
    return false
  }
}
