package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R

/** URLs embarquées au prebuild + repli miroir disque après 1ère sync JS. */
object BlypShellConfig {
  private const val MIRROR = "blyp_shell_auth_mirror_v1"
  private const val KEY_API = "api_base_url"
  private const val KEY_WS = "realtime_ws_url"
  private const val KEY_CDN = "assets_cdn_url"

  private fun mirrorPrefs(context: Context) =
    context.applicationContext.getSharedPreferences(MIRROR, Context.MODE_PRIVATE)

  fun apiBaseUrl(context: Context): String {
    val fromDisk = mirrorPrefs(context).getString(KEY_API, "").orEmpty().trim().trimEnd('/')
    if (fromDisk.isNotEmpty()) return fromDisk
    return readString(context, R.string.blyp_api_base_url)
  }

  fun realtimeWsUrl(context: Context): String {
    val fromDisk = mirrorPrefs(context).getString(KEY_WS, "").orEmpty().trim().trimEnd('/')
    if (fromDisk.isNotEmpty()) return fromDisk
    return readString(context, R.string.blyp_realtime_ws_url)
  }

  fun assetsCdnUrl(context: Context): String {
    val fromDisk = mirrorPrefs(context).getString(KEY_CDN, "").orEmpty().trim().trimEnd('/')
    if (fromDisk.isNotEmpty()) return fromDisk
    return readString(context, R.string.blyp_assets_cdn_url)
  }

  fun hasApiForAuth(context: Context): Boolean = apiBaseUrl(context).isNotEmpty()

  private fun readString(context: Context, resId: Int): String {
    return try {
      context.getString(resId).trim().trimEnd('/')
    } catch (_: Exception) {
      ""
    }
  }
}
