package com.haroldndougou.blyp.quickpaynotif

import android.content.Context

/** Montant en attente si React n’est pas prêt au tap notif. */
object QuickPayPendingStore {
  private const val PREFS = "blyp_quick_pay_pending"
  private const val KEY_AMOUNT = "amount_fcfa"

  fun set(context: Context, amountFcfa: Int) {
    if (amountFcfa <= 0) return
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_AMOUNT, amountFcfa)
      .apply()
  }

  fun take(context: Context): Int {
    val prefs =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val amount = prefs.getInt(KEY_AMOUNT, 0)
    if (amount > 0) {
      prefs.edit().remove(KEY_AMOUNT).apply()
    }
    return amount
  }
}
