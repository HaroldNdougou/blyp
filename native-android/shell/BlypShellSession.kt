package com.haroldndougou.blyp.shell

import android.content.Context

/** Session miroir (non secrète) pour la coque native — alimentée par JS au login. */
object BlypShellSession {
  private const val PREFS = "blyp_shell_session"
  private const val KEY_PHONE = "phone"
  private const val KEY_ACCOUNT_ID = "account_id"
  private const val KEY_SIGNED_IN = "signed_in"
  private const val KEY_DISPLAY_NAME = "display_name"
  private const val KEY_BALANCE = "balance_fcfa"
  private const val KEY_AVATAR_URL = "avatar_url"
  private const val KEY_MESSAGES_UNREAD = "messages_unread"
  private const val KEY_RECEIPTS_UNREAD = "receipts_unread"
  private const val KEY_COMMERCE_MODE = "commerce_mode"
  private const val KEY_KYC_STATUS = "kyc_status"
  private const val KEY_NEEDS_ONBOARDING = "needs_onboarding"
  private const val KEY_PAY_BLOCKED = "pay_blocked"
  private const val KEY_SMALL_PAY = "small_pay_without_pin"

  data class ProfileSnapshot(
    val phone: String,
    val displayName: String,
    val balanceFcfa: Int,
    val avatarUrl: String?,
    val kycStatus: String,
  )

  fun sync(
    context: Context,
    phone: String?,
    accountId: String?,
    signedIn: Boolean,
    displayName: String?,
    balanceFcfa: Int,
    avatarUrl: String?,
    isCommerceMode: Boolean,
    kycStatus: String?,
    needsOnboarding: Boolean,
  ) {
    val p = phone?.trim().orEmpty()
    val acct = accountId?.trim().orEmpty()
    val kyc = kycStatus?.trim()?.lowercase()?.ifEmpty { "none" } ?: "none"
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PHONE, p)
      .putString(KEY_ACCOUNT_ID, acct)
      .putBoolean(KEY_SIGNED_IN, signedIn && p.isNotEmpty())
      .putString(KEY_DISPLAY_NAME, displayName?.trim().orEmpty())
      .putInt(KEY_BALANCE, balanceFcfa.coerceAtLeast(0))
      .putString(KEY_AVATAR_URL, avatarUrl?.trim().orEmpty())
      .putBoolean(KEY_COMMERCE_MODE, isCommerceMode)
      .putString(KEY_KYC_STATUS, kyc)
      .putBoolean(KEY_NEEDS_ONBOARDING, needsOnboarding)
      .apply()
    BlypShellPayDossierRam.invalidate()
    BlypShellPayDossierStore.refreshFromSources(context.applicationContext)
  }

  fun clear(context: Context) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()
    BlypShellAuthMirror.clear(context)
    BlypShellRuntime.clear(context)
    BlypShellPayRuntime.clear(context)
    BlypShellJsAuthPending.clear(context)
  }

  fun updateBalance(context: Context, balanceFcfa: Int) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_BALANCE, balanceFcfa.coerceAtLeast(0))
      .apply()
  }

  fun syncMessagesUnread(context: Context, count: Int) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_MESSAGES_UNREAD, count.coerceAtLeast(0))
      .apply()
  }

  fun syncReceiptsUnread(context: Context, count: Int) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_RECEIPTS_UNREAD, count.coerceAtLeast(0))
      .apply()
  }

  fun messagesUnread(context: Context): Int {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(KEY_MESSAGES_UNREAD, 0)
      .coerceAtLeast(0)
  }

  fun receiptsUnread(context: Context): Int {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(KEY_RECEIPTS_UNREAD, 0)
      .coerceAtLeast(0)
  }

  fun hasValidSession(context: Context): Boolean {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs      .getBoolean(KEY_SIGNED_IN, false) &&
      prefs.getString(KEY_PHONE, "").orEmpty().isNotEmpty()
  }

  fun accountId(context: Context): String? {
    val id =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_ACCOUNT_ID, "")
        .orEmpty()
        .trim()
    return id.ifEmpty { null }
  }

  fun phone(context: Context): String? {
    val p =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_PHONE, "")
        .orEmpty()
        .trim()
    return p.ifEmpty { null }
  }

  fun profile(context: Context): ProfileSnapshot? {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val phone = prefs.getString(KEY_PHONE, "")?.trim().orEmpty()
    if (phone.isEmpty()) return null
    return ProfileSnapshot(
      phone = phone,
      displayName = prefs.getString(KEY_DISPLAY_NAME, "")?.trim().orEmpty().ifEmpty { "—" },
      balanceFcfa = prefs.getInt(KEY_BALANCE, 0),
      avatarUrl = prefs.getString(KEY_AVATAR_URL, "")?.trim()?.ifEmpty { null },
      kycStatus = prefs.getString(KEY_KYC_STATUS, "none")?.trim()?.lowercase() ?: "none",
    )
  }

  fun isCommerceMode(context: Context): Boolean {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY_COMMERCE_MODE, false)
  }

  /** Paiements suspendus par Blyp — vient du serveur (profil ou refus de paiement). */
  fun setPayBlocked(context: Context, blocked: Boolean) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getBoolean(KEY_PAY_BLOCKED, false) == blocked) return
    prefs.edit().putBoolean(KEY_PAY_BLOCKED, blocked).apply()
    BlypShellPayDossierRam.invalidate()
    BlypShellPayDossierStore.refreshFromSources(context.applicationContext)
  }

  fun isPayBlocked(context: Context): Boolean {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY_PAY_BLOCKED, false)
  }

  fun needsOnboarding(context: Context): Boolean {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY_NEEDS_ONBOARDING, false)
  }

  fun smallPayWithoutPin(context: Context): Boolean {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY_SMALL_PAY, false)
  }

  fun persistSmallPayWithoutPin(context: Context, enabled: Boolean) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_SMALL_PAY, enabled)
      .apply()
  }
}
