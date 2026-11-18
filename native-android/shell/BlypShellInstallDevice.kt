package com.haroldndougou.blyp.shell

import android.content.Context
import java.util.UUID

/** Même id d’installation que le client JS (push / pay). */
object BlypShellInstallDevice {
  private const val PREFS = "blyp_shell_install_device_v1"
  private const val KEY = "device_id"

  fun getOrCreate(context: Context): String {
    val p =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val existing = p.getString(KEY, "")?.trim().orEmpty()
    if (existing.isNotEmpty()) return existing
    val id = "d_${UUID.randomUUID()}"
    p.edit().putString(KEY, id).apply()
    return id
  }

  fun adoptFromJs(context: Context, deviceId: String?) {
    val id = deviceId?.trim().orEmpty()
    if (id.isEmpty()) return
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, id)
      .apply()
  }
}
