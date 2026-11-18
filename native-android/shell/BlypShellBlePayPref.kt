package com.haroldndougou.blyp.shell

import android.content.Context

/** Détection / paiement par Bluetooth : l’utilisateur peut tout couper (plus aucune demande Bluetooth). */
object BlypShellBlePayPref {
  private const val PREFS = "blyp_shell_ble_pay"
  private const val KEY = "enabled"

  fun isEnabled(context: Context): Boolean =
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY, true)

  fun setEnabled(context: Context, enabled: Boolean) {
    val app = context.applicationContext
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, enabled).apply()
    BlypShellNearbyScan.onBlePayPrefChanged(app)
  }
}
