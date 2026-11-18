package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.time.Instant
import java.util.Locale

/** Paiement reçu (WS / push) → SQLite coque + solde sans React. */
object BlypShellWalletIngest {
  private val seenTxIds = LinkedHashSet<String>()
  private val recentLocal =
    ArrayDeque<LocalCredit>()
  private val applied =
    ArrayDeque<LocalCredit>()

  private data class LocalCredit(
    val txId: String,
    val amount: Int,
    val commerceId: String,
    val at: Long,
  )

  fun ingestPayload(context: Context, data: JSONObject) {
    when (data.optString("type", "").trim()) {
      "payment_received" -> ingestPaymentReceived(context, data)
      "wallet_balance" -> ingestBalancePatch(context, data)
    }
  }

  private fun ingestPaymentReceived(context: Context, data: JSONObject) {
    val phone = BlypShellSession.phone(context) ?: return
    val amount = data.optInt("amountFcfa", 0)
    if (amount <= 0) return

    val contextType = data.optString("contextType", "personal").trim()
    val isCommercePayment = contextType == "commerce"
    val commerceId = data.optString("commerceId", "").trim().ifEmpty { null }
    val inCommerceMode = BlypShellSession.isCommerceMode(context)

    if (isCommercePayment) {
      if (inCommerceMode) {
        val activeId = BlypShellCommerceSession.activeCommerceId(context)
        if (activeId != null && commerceId != null && activeId != commerceId) return
      }
    } else if (inCommerceMode) {
      return
    }

    val txId =
      data.optString("transactionId", "").trim().ifEmpty {
        "rx-${System.currentTimeMillis()}"
      }
    val fromName = data.optString("fromName", "").trim().ifEmpty { "—" }
    val createdAt = Instant.now().toString()
    val alreadyLocal = takeLocalCredit(amount, commerceId)
    if (alreadyLocal != null) {
      rememberTx(txId)
      BlypTransactionStore.deleteTransaction(context, phone, alreadyLocal.txId)
      BlypTransactionStore.insertReceivedTransaction(
        context,
        phone,
        txId,
        amount,
        fromName,
        null,
        createdAt,
        txId,
      )
      BlypShellUiRefresh.notifyWalletChanged()
      return
    }
    if (!rememberTx(txId)) return
    if (!isCommercePayment || inCommerceMode) {
      BlypTransactionStore.insertReceivedTransaction(
        context,
        phone,
        txId,
        amount,
        fromName,
        null,
        createdAt,
        txId,
      )
    }

    val profile = BlypShellSession.profile(context)
    if (profile != null) {
      val shouldPatchBalance =
        !isCommercePayment || inCommerceMode
      if (shouldPatchBalance) {
        val nextBalance =
          data.optInt("balanceFcfa", -1).takeIf { it >= 0 }
            ?: (profile.balanceFcfa + amount)
        BlypShellPayRuntime.updateBalance(context, nextBalance)
      }
      if (isCommercePayment && commerceId != null) {
        BlypShellCommerceSession.addBalance(context, commerceId, amount)
        noteApplied(amount, commerceId, txId)
      }
    }

    if (isCommercePayment && inCommerceMode) {
      BlypShellIncomingFlash.notifyCommerceReceived(amount, txId)
      val lang =
        if (Locale.getDefault().language == "fr") "fr" else "en"
      com.haroldndougou.blyp.paymentannounce.PaymentAnnounceController.announceServer(
        context,
        amount,
        lang,
        txId,
        fromName,
      )
    }

    BlypShellUiRefresh.notifyWalletChanged()
    BlypShellBackgroundSync.scheduleDelta(context, phone)
  }

  /**
   * Réception Bluetooth : solde du commerce, historique et ligne reçue tout de suite.
   * Le serveur, plus tard, ne refait que remplacer l’identifiant.
   */
  fun applyLocalCommerceCredit(
    context: Context,
    commerceId: String,
    txId: String,
    amountFcfa: Int,
    fromName: String,
    fromPhone: String?,
  ) {
    val phone = BlypShellSession.phone(context) ?: return
    val amount = amountFcfa.coerceAtLeast(0)
    val id = txId.trim()
    if (amount <= 0 || id.isEmpty()) return
    /** Le serveur a déjà compté ce paiement avant la caisse Bluetooth : on le consomme une seule fois. */
    if (takeApplied(amount, commerceId) != null) {
      rememberTx(id)
      return
    }
    if (!rememberTx(id)) return
    val createdAt = Instant.now().toString()
    BlypTransactionStore.insertReceivedTransaction(
      context,
      phone,
      id,
      amount,
      fromName.ifBlank { "—" },
      fromPhone,
      createdAt,
      id,
    )
    BlypShellCommerceSession.addBalance(context, commerceId, amount)
    val viewing =
      BlypShellSession.isCommerceMode(context) &&
        BlypShellCommerceSession.activeCommerceId(context) == commerceId
    if (viewing) {
      val current = BlypShellSession.profile(context)?.balanceFcfa ?: 0
      BlypShellPayRuntime.updateBalance(context, current + amount)
    }
    synchronized(recentLocal) {
      recentLocal.addLast(LocalCredit(id, amount, commerceId, System.currentTimeMillis()))
      while (recentLocal.size > 30) recentLocal.removeFirst()
    }
    BlypShellUiRefresh.notifyWalletChanged()
  }

  private fun rememberTx(txId: String): Boolean {
    synchronized(seenTxIds) {
      if (seenTxIds.contains(txId)) return false
      if (seenTxIds.size > 200) {
        val drop = seenTxIds.iterator()
        if (drop.hasNext()) {
          drop.next()
          drop.remove()
        }
      }
      seenTxIds.add(txId)
      return true
    }
  }

  private fun noteApplied(amount: Int, commerceId: String, txId: String) {
    synchronized(applied) {
      applied.addLast(LocalCredit(txId, amount, commerceId, System.currentTimeMillis()))
      while (applied.size > 30) applied.removeFirst()
    }
  }

  private fun takeApplied(amount: Int, commerceId: String): LocalCredit? {
    val now = System.currentTimeMillis()
    synchronized(applied) {
      val i =
        applied.indexOfFirst {
          now - it.at < 120_000L && it.amount == amount && it.commerceId == commerceId
        }
      if (i < 0) return null
      return applied.removeAt(i)
    }
  }

  private fun takeLocalCredit(amount: Int, commerceId: String?): LocalCredit? {
    val now = System.currentTimeMillis()
    synchronized(recentLocal) {
      val i =
        recentLocal.indexOfFirst {
          now - it.at < 120_000L &&
            it.amount == amount &&
            (commerceId.isNullOrEmpty() || it.commerceId == commerceId)
        }
      if (i < 0) return null
      return recentLocal.removeAt(i)
    }
  }

  private fun ingestBalancePatch(context: Context, data: JSONObject) {
    val balance = data.optInt("balanceFcfa", -1)
    if (balance < 0) return
    BlypShellPayRuntime.updateBalance(context, balance)
    BlypShellUiRefresh.notifyWalletChanged()
  }
}
