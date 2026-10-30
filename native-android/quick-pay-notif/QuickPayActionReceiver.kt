package com.haroldndougou.blyp.quickpaynotif

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class QuickPayActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val amount = intent?.getIntExtra(EXTRA_AMOUNT, 0) ?: 0
    if (amount <= 0) return
    QuickPayNotifService.highlightAmount(context, amount)
    QuickPayAuthActivity.start(context, amount)
  }

  companion object {
    const val EXTRA_AMOUNT = "amountFcfa"
  }
}
