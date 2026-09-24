package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import java.util.Locale

object PaymentAnnouncePrefs {
  private const val PREFS = "blyp_payment_announce"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_LANG = "lang"
  private const val KEY_LAST_TX = "last_tx"
  private const val KEY_ACTIVE_CONV = "active_conversation"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_ENABLED, enabled)
      .apply()
    if (enabled) {
      PaymentAnnounceEngine.warm(context.applicationContext)
    } else {
      PaymentAnnounceEngine.shutdown()
    }
  }

  fun getLang(context: Context): String {
    val stored =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_LANG, null)
    if (stored == "fr" || stored == "en") return stored
    return if (Locale.getDefault().language.equals("fr", ignoreCase = true)) "fr" else "en"
  }

  fun setLang(context: Context, lang: String) {
    val v = if (lang.startsWith("fr", ignoreCase = true)) "fr" else "en"
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_LANG, v)
      .apply()
  }

  fun setActiveConversation(context: Context, conversationId: String?) {
    val v = conversationId?.trim().orEmpty()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ACTIVE_CONV, v)
      .apply()
  }

  fun getActiveConversation(context: Context): String =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_ACTIVE_CONV, "")
      ?.trim()
      .orEmpty()

  fun claimTransaction(context: Context, txId: String): Boolean {
    if (txId.isBlank()) return true
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val prev = prefs.getString(KEY_LAST_TX, null)
    if (prev == txId) return false
    prefs.edit().putString(KEY_LAST_TX, txId).apply()
    return true
  }
}
