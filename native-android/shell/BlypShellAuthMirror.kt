package com.haroldndougou.blyp.shell

import android.content.Context

/**
 * Copie disque de la session (écrite à chaque sync JS) pour cold start coque sans monter React.
 * Cold start coque sans monter React (connexion OTP native ou sync JS).
 */
object BlypShellAuthMirror {
  private const val PREFS = "blyp_shell_auth_mirror_v1"
  private const val KEY_SIGNED_IN = "signed_in"
  private const val KEY_PHONE = "phone"
  private const val KEY_ACCOUNT_ID = "account_id"
  private const val KEY_DISPLAY_NAME = "display_name"
  private const val KEY_BALANCE = "balance_fcfa"
  private const val KEY_AVATAR_URL = "avatar_url"
  private const val KEY_COMMERCE = "commerce_mode"
  private const val KEY_KYC = "kyc_status"
  private const val KEY_ONBOARDING = "needs_onboarding"
  private const val KEY_API = "api_base_url"
  private const val KEY_TOKEN = "access_token"
  private const val KEY_CDN = "assets_cdn_url"
  private const val KEY_WS = "realtime_ws_url"

  fun wsBaseUrl(context: Context): String {
    val stored =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_WS, "")
        .orEmpty()
        .trim()
    return stored.ifEmpty { BlypShellConfig.realtimeWsUrl(context) }
  }

  fun persist(
    context: Context,
    phone: String?,
    accountId: String?,
    signedIn: Boolean,
    displayName: String?,
    balanceFcfa: Int,
    avatarUrl: String?,
    apiBaseUrl: String?,
    accessToken: String?,
    assetsCdnUrl: String?,
    realtimeWsUrl: String?,
    isCommerceMode: Boolean,
    kycStatus: String?,
    needsOnboarding: Boolean,
  ) {
    val p = phone?.trim().orEmpty()
    val kyc = kycStatus?.trim()?.lowercase()?.ifEmpty { "none" } ?: "none"
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_SIGNED_IN, signedIn && p.isNotEmpty())
      .putString(KEY_PHONE, p)
      .putString(KEY_ACCOUNT_ID, accountId?.trim().orEmpty())
      .putString(KEY_DISPLAY_NAME, displayName?.trim().orEmpty())
      .putInt(KEY_BALANCE, balanceFcfa.coerceAtLeast(0))
      .putString(KEY_AVATAR_URL, avatarUrl?.trim().orEmpty())
      .putBoolean(KEY_COMMERCE, isCommerceMode)
      .putString(KEY_KYC, kyc)
      .putBoolean(KEY_ONBOARDING, needsOnboarding)
      .putString(KEY_API, apiBaseUrl?.trim()?.trimEnd('/') ?: "")
      .putString(KEY_TOKEN, accessToken?.trim() ?: "")
      .putString(KEY_CDN, assetsCdnUrl?.trim()?.trimEnd('/') ?: "")
      .putString(KEY_WS, realtimeWsUrl?.trim()?.trimEnd('/') ?: "")
      .apply()
  }

  fun updateAccessToken(context: Context, accessToken: String) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_TOKEN, accessToken.trim())
      .apply()
  }

  fun clear(context: Context) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()
  }

  /** Restaure session + runtime si la coque démarre sans React (launcher natif). */
  fun ensureHydrated(context: Context) {
    val app = context.applicationContext
    if (BlypShellSession.hasValidSession(app) && BlypShellRuntime.read(app) != null) return

    val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(KEY_SIGNED_IN, false)) return
    val phone = prefs.getString(KEY_PHONE, "").orEmpty().trim()
    if (phone.isEmpty()) return

    val accountId =
      prefs.getString(KEY_ACCOUNT_ID, "").orEmpty().trim().ifEmpty { null }
    BlypShellSession.sync(
      app,
      phone,
      accountId,
      true,
      prefs.getString(KEY_DISPLAY_NAME, ""),
      prefs.getInt(KEY_BALANCE, 0),
      prefs.getString(KEY_AVATAR_URL, "")?.trim()?.ifEmpty { null },
      prefs.getBoolean(KEY_COMMERCE, false),
      prefs.getString(KEY_KYC, "none"),
      prefs.getBoolean(KEY_ONBOARDING, false),
    )
    val api = prefs.getString(KEY_API, "").orEmpty()
    val token = prefs.getString(KEY_TOKEN, "").orEmpty()
    val cdn = prefs.getString(KEY_CDN, "").orEmpty()
    if (api.isNotEmpty() && token.isNotEmpty()) {
      BlypShellRuntime.sync(app, api, token, cdn.ifEmpty { null })
    }
  }
}
