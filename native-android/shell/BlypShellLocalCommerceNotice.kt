package com.haroldndougou.blyp.shell

import org.json.JSONObject

/** OK caisse immédiat — aligné `lib/pay/localCommercePayNotice.ts`. */
object BlypShellLocalCommerceNotice {
  const val PAY_RECEIPT_TTL_MS = 60_000L

  fun build(
    idempotencyKey: String,
    optimisticTxId: String,
    amountFcfa: Int,
    recipientAccountId: String,
    cashierSession: Int,
    payerName: String,
    payerPhone: String?,
  ): JSONObject? {
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) return null
    val recipient = recipientAccountId.trim().uppercase()
    if (recipient.isBlank()) return null
    val issuedAt = System.currentTimeMillis()
    return JSONObject().apply {
      put("v", 2)
      put("localAccept", true)
      put("transactionId", optimisticTxId.trim())
      put("idempotencyKey", idempotencyKey.trim())
      put("reference", payerName.trim().ifEmpty { "—" })
      put("payerPhone", payerPhone?.trim()?.ifEmpty { null } ?: JSONObject.NULL)
      put("amountFcfa", amount)
      put("recipientAccountId", recipient)
      put("commerceId", JSONObject.NULL)
      put("cashierSession", cashierSession)
      put("issuedAt", issuedAt)
      put("expiresAt", issuedAt + PAY_RECEIPT_TTL_MS)
    }
  }
}
