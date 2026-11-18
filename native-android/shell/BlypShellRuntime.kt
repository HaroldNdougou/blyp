package com.haroldndougou.blyp.shell

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Token + API pour sync réseau depuis la coque (miroir JS, chiffré). */
object BlypShellRuntime {
  private const val PREFS = "blyp_shell_runtime_v1"
  private const val KEY_API = "api_base_url"
  private const val KEY_TOKEN = "access_token"
  private const val KEY_ASSETS_CDN = "assets_cdn_url"
  private const val KEY_REFRESH = "refresh_token"

  private fun prefs(context: Context) = BlypSecurePrefs.get(context, PREFS)

  fun sync(
    context: Context,
    apiBaseUrl: String?,
    accessToken: String?,
    assetsCdnUrl: String? = null,
  ) {
    val api = apiBaseUrl?.trim()?.trimEnd('/') ?: ""
    val token = accessToken?.trim() ?: ""
    val cdn = assetsCdnUrl?.trim()?.trimEnd('/') ?: ""
    prefs(context).edit().apply {
      if (api.isNotEmpty()) putString(KEY_API, api)
      if (token.isNotEmpty()) putString(KEY_TOKEN, token)
      else remove(KEY_TOKEN)
      if (cdn.isNotEmpty()) putString(KEY_ASSETS_CDN, cdn)
      apply()
    }
  }

  fun refreshToken(context: Context): String? =
    prefs(context).getString(KEY_REFRESH, "")?.trim()?.ifEmpty { null }

  fun setRefreshToken(context: Context, refreshToken: String?) {
    val r = refreshToken?.trim().orEmpty()
    prefs(context).edit().apply {
      if (r.isNotEmpty()) putString(KEY_REFRESH, r) else remove(KEY_REFRESH)
      apply()
    }
  }

  /** Réseau (hors fil principal) : access renouvelé s’il expire bientôt. */
  fun readFresh(context: Context): Snapshot? {
    if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
      BlypShellSessionRefresh.freshAccessBlocking(context.applicationContext)
    }
    return read(context)
  }

  fun assetsCdnBase(context: Context): String {
    val stored = prefs(context).getString(KEY_ASSETS_CDN, "")?.trim().orEmpty()
    if (stored.isNotEmpty()) return stored
    return BlypShellConfig.assetsCdnUrl(context)
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  data class Snapshot(val apiBaseUrl: String, val accessToken: String)

  fun read(context: Context): Snapshot? {
    val p = prefs(context)
    val api = p.getString(KEY_API, "")?.trim().orEmpty()
    val token = p.getString(KEY_TOKEN, "")?.trim().orEmpty()
    if (api.isBlank() || token.isBlank()) return null
    return Snapshot(api, token)
  }
}
