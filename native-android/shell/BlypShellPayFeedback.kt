package com.haroldndougou.blyp.shell

/** Montant du dernier paiement natif réussi (affiché sur l’onglet Pay). */
object BlypShellPayFeedback {
  @Volatile private var pendingSuccessAmountFcfa: Int = 0

  fun markPaySuccess(amountFcfa: Int) {
    if (amountFcfa > 0) pendingSuccessAmountFcfa = amountFcfa
  }

  fun consumeSuccessAmountFcfa(): Int {
    val v = pendingSuccessAmountFcfa
    pendingSuccessAmountFcfa = 0
    return v
  }
}
