package com.haroldndougou.blyp.quickpaynotif

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class QuickPayActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    when (intent?.action) {
      ACTION_STAY -> return
      ACTION_SCAN -> {
        val app = context.applicationContext
        if (!com.haroldndougou.blyp.shell.BlypShellNearbyScan.hasScanPermission(app)) return
        com.haroldndougou.blyp.shell.BlypShellQuickPayPref.rescan(app)
        return
      }
      ACTION_NOT_READY -> {
        android.widget.Toast.makeText(
          context.applicationContext,
          context.getString(com.haroldndougou.blyp.R.string.quick_pay_no_recipient),
          android.widget.Toast.LENGTH_SHORT,
        ).show()
        return
      }
    }
    val amount = intent?.getIntExtra(EXTRA_AMOUNT, 0) ?: 0
    if (amount <= 0) return
    QuickPayNotifService.highlightAmount(context, amount)
    QuickPayNotifBridge.emitPayRequested(context, amount)
    QuickPayAuthActivity.start(context, amount)
  }

  companion object {
    const val EXTRA_AMOUNT = "amountFcfa"
    const val ACTION_SCAN = "com.haroldndougou.blyp.action.QUICK_PAY_SCAN"
    const val ACTION_STAY = "com.haroldndougou.blyp.action.QUICK_PAY_STAY"
    const val ACTION_NOT_READY = "com.haroldndougou.blyp.action.QUICK_PAY_NOT_READY"
  }
}
