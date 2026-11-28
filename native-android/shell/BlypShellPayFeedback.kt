package com.haroldndougou.blyp.shell

/** Montant du dernier paiement natif réussi (affiché sur l’onglet Pay). */
object BlypShellPayFeedback {
  @Volatile private var pendingSuccessAmountFcfa: Int = 0
  @Volatile private var askMotifAfterSuccess: Boolean = false
  @Volatile private var pendingMotif: String? = null

  fun markPaySuccess(amountFcfa: Int) {
    if (amountFcfa > 0) {
      pendingSuccessAmountFcfa = amountFcfa
      askMotifAfterSuccess = true
    }
  }

  fun consumeSuccessAmountFcfa(): Int {
    val v = pendingSuccessAmountFcfa
    pendingSuccessAmountFcfa = 0
    return v
  }

  fun consumeAskMotif(): Boolean {
    val v = askMotifAfterSuccess
    askMotifAfterSuccess = false
    return v
  }

  /** Motif saisi après succès — collé à la prochaine écriture d’envoi. */
  fun setPendingMotif(note: String?) {
    pendingMotif = BlypShellPayMotif.sanitize(note)
  }

  fun consumePendingMotifForAmount(amountFcfa: Int): String? {
    if (amountFcfa <= 0) return null
    val note = pendingMotif ?: return null
    pendingMotif = null
    return note
  }

  fun peekPendingMotif(): String? = pendingMotif
}
