package com.haroldndougou.blyp.shell

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Session OTP native → adoptée par React au prochain montage (îlot Messages). */
object BlypShellJsAuthPending {
  private const val PREFS = "blyp_shell_js_auth_pending_v1"
  private const val KEY_ACCESS = "access_token"
  private const val KEY_REFRESH = "refresh_token"
  private const val KEY_USER = "user_json"
  private const val KEY_PIN = "pending_pin"

  data class Payload(
    val accessToken: String,
    val refreshToken: String?,
    val userJson: String,
    val pendingPin: String?,
  )

  private fun prefs(context: Context) = BlypSecurePrefs.get(context, PREFS)

  fun enqueue(
    context: Context,
    accessToken: String,
    refreshToken: String?,
    userJson: String,
  ) {
    val token = accessToken.trim()
    val user = userJson.trim()
    if (token.isEmpty() || user.isEmpty()) return
    prefs(context).edit().apply {
      putString(KEY_ACCESS, token)
      putString(KEY_REFRESH, refreshToken?.trim().orEmpty())
      putString(KEY_USER, user)
      apply()
    }
  }

  /** PIN choisi côté natif — chiffré, remis à React avec la session puis effacé. */
  fun enqueuePin(context: Context, pin: String) {
    val digits = pin.replace(Regex("\\D"), "")
    if (digits.length != 4) return
    prefs(context).edit().putString(KEY_PIN, digits).apply()
  }

  fun consume(context: Context): Payload? {
    val p = prefs(context)
    val access = p.getString(KEY_ACCESS, "").orEmpty().trim()
    val user = p.getString(KEY_USER, "").orEmpty().trim()
    if (access.isEmpty() || user.isEmpty()) return null
    val refresh = p.getString(KEY_REFRESH, "").orEmpty().trim().ifEmpty { null }
    val pin = p.getString(KEY_PIN, "").orEmpty().trim().ifEmpty { null }
    p.edit().clear().apply()
    return Payload(access, refresh, user, pin)
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }
}
