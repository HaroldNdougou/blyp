package com.haroldndougou.blyp.quickpaynotif

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/** Données minimales pour payer depuis la notif sans monter React. */
object QuickPayNativeSecrets {
  private const val PREFS = "blyp_quick_pay_runtime_v1"
  private const val KEY_API = "api_base_url"
  private const val KEY_TOKEN = "access_token"
  private const val KEY_RECIPIENT = "recipient_json"
  private const val KEY_PIN = "transaction_pin"
  private const val KEY_BALANCE = "balance_fcfa"
  private const val KEY_PHONE = "phone_digits"

  @Volatile private var cachedPrefs: android.content.SharedPreferences? = null

  private fun prefs(context: Context): android.content.SharedPreferences =
    cachedPrefs ?: synchronized(this) {
      cachedPrefs ?: EncryptedSharedPreferences.create(
        context.applicationContext,
        PREFS,
        MasterKey.Builder(context.applicationContext)
          .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
          .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      ).also { cachedPrefs = it }
    }

  fun sync(
    context: Context,
    apiBaseUrl: String,
    accessToken: String,
    recipientJson: String,
    transactionPin: String,
    balanceFcfa: Int,
    phoneDigits: String,
  ) {
    val pin = transactionPin.replace(Regex("\\D"), "")
    prefs(context).edit().apply {
      putString(KEY_API, apiBaseUrl.trim().trimEnd('/'))
      putString(KEY_TOKEN, accessToken.trim())
      putString(KEY_RECIPIENT, recipientJson)
      if (pin.length == 4) putString(KEY_PIN, pin)
      if (balanceFcfa >= 0) putInt(KEY_BALANCE, balanceFcfa)
      putString(KEY_PHONE, phoneDigits.replace(Regex("\\D"), ""))
      apply()
    }
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  fun isReady(context: Context): Boolean {
    val p = prefs(context)
    if (p.getString(KEY_API, "").isNullOrBlank()) return false
    if (p.getString(KEY_TOKEN, "").isNullOrBlank()) return false
    val rec = p.getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (rec.isBlank()) return false
    val accountId =
      runCatching { JSONObject(rec).optString("accountId", "").trim() }.getOrDefault("")
    if (accountId.isBlank()) return false
    if (p.getString(KEY_PIN, "")?.replace(Regex("\\D"), "")?.length != 4) return false
    return true
  }

  data class Snapshot(
    val apiBaseUrl: String,
    val accessToken: String,
    val recipientJson: String,
    val transactionPin: String,
    val balanceFcfa: Int,
    val phoneDigits: String,
  )

  fun read(context: Context): Snapshot? {
    val p = prefs(context)
    val api = p.getString(KEY_API, "")?.trim().orEmpty()
    val token = p.getString(KEY_TOKEN, "")?.trim().orEmpty()
    val recipient = p.getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    val pin = p.getString(KEY_PIN, "")?.replace(Regex("\\D"), "").orEmpty()
    val accountId =
      runCatching { JSONObject(recipient).optString("accountId", "").trim() }.getOrDefault("")
    if (api.isBlank() || token.isBlank() || accountId.isBlank() || pin.length != 4) {
      return null
    }
    return Snapshot(
      apiBaseUrl = api,
      accessToken = token,
      recipientJson = recipient,
      transactionPin = pin,
      balanceFcfa = p.getInt(KEY_BALANCE, 0),
      phoneDigits = p.getString(KEY_PHONE, "").orEmpty(),
    )
  }

  fun updateBalance(context: Context, balanceFcfa: Int) {
    prefs(context).edit().putInt(KEY_BALANCE, balanceFcfa.coerceAtLeast(0)).apply()
  }
}
