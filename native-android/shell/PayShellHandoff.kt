package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent

/** Handoff coque → dépôt natif ; choix destinataire natif (plus de Pay RN). */
object PayShellHandoff {
  fun depositIntent(context: Context): Intent =
    Intent(context, ShellDepositActivity::class.java)

  fun openPickRecipient(context: Context, pendingPayAmountFcfa: Int = 0) {
    ShellPickRecipientActivity.start(context, pendingPayAmountFcfa)
  }

  fun openDeposit(context: Context) {
    ShellDepositActivity.start(context)
  }
}
