package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object BlypShellPayExecutor {
  private val io = Executors.newSingleThreadExecutor()

  data class PayResult(
    val ok: Boolean,
    val balanceFcfa: Int = 0,
    val transactionId: String? = null,
    val message: String? = null,
  )

  fun payAsync(
    context: Context,
    amountFcfa: Int,
    onDone: (PayResult) -> Unit,
    idempotencyKey: String? = null,
  ) {
    io.execute {
      onDone(paySync(context, amountFcfa, null, idempotencyKey))
    }
  }

  fun paySync(
    context: Context,
    amountFcfa: Int,
    recipientJsonOverride: String? = null,
    idempotencyKey: String? = null,
    cashierSession: Int? = null,
    optimisticTxIdToReplace: String? = null,
    skewRetried: Boolean = false,
    authRetried: Boolean = false,
  ): PayResult {
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) return PayResult(false, message = "invalid_amount")
    BlypShellSessionRefresh.accessForSignedPay(context.applicationContext)
    val runtime = BlypShellRuntime.read(context.applicationContext)
      ?: return PayResult(false, message = "not_configured")
    val pay = BlypShellPayRuntime.read(context.applicationContext)
      ?: return PayResult(false, message = "not_configured")
    if (amount > pay.balanceFcfa) {
      return PayResult(false, message = "insufficient_balance")
    }
    val recipientRaw = recipientJsonOverride?.trim()?.ifEmpty { null } ?: pay.recipientJson
    return try {
      val recipient = JSONObject(recipientRaw)
      val recipientName = recipient.optString("name", "").trim()
      val accountId = recipient.optString("accountId", "").trim()
      val phone =
        recipient.optString("phoneDigits", "").replace(Regex("\\D"), "").takeLast(9)
      if (recipientName.isBlank() || accountId.isBlank()) {
        return PayResult(false, message = "no_recipient")
      }
      val body =
        JSONObject().apply {
          put("amount", amount)
          put("recipientName", recipientName)
          put("recipientPhone", if (phone.isBlank()) JSONObject.NULL else phone)
          put("recipientAccountId", accountId)
          put("transactionPin", pay.transactionPin)
          if (cashierSession != null && cashierSession > 0) {
            put("cashierSession", cashierSession)
          }
        }
      val idem = idempotencyKey?.trim()?.takeIf { it.isNotEmpty() }
      val url = URL("${runtime.apiBaseUrl}/payments/pay")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 20_000
        readTimeout = 25_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        idem?.let { setRequestProperty("Idempotency-Key", it) }
      }
      val t0 = android.os.SystemClock.elapsedRealtime()
      val bodyText = body.toString()
      BlypShellDeviceKey.applyProof(conn, runtime.apiBaseUrl, "POST", bodyText)
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write(bodyText)
      }
      val code = conn.responseCode
      BlypShellDeviceKey.noteServerDate(conn)
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val text =
        stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
      conn.disconnect()
      BlypShellDeviceKey.perf("pay_http", t0, " http=$code")
      /** Refus avant exécution (horloge décalée) : renvoi unique, sans risque de double débit. */
      if (code == 403 && !skewRetried && BlypShellDeviceKey.handleSkewResponse(text)) {
        return paySync(
          context,
          amountFcfa,
          recipientJsonOverride,
          idempotencyKey,
          cashierSession,
          optimisticTxIdToReplace,
          skewRetried = true,
          authRetried = authRetried,
        )
      }
      if (code !in 200..299) {
        if (BlypShellSessionReplaced.isSessionReplacedResponse(code, text)) {
          BlypShellSessionReplaced.kickToSignIn(context.applicationContext)
          return PayResult(false, message = "session_replaced")
        }
        /** Jeton expiré : refus avant exécution → renouvelle puis renvoi unique (même clé idempotence). */
        if (code == 401 && !authRetried &&
          BlypShellSessionRefresh.refreshAfterUnauthorized(context, runtime.accessToken) != null
        ) {
          return paySync(
            context,
            amountFcfa,
            recipientJsonOverride,
            idempotencyKey,
            cashierSession,
            optimisticTxIdToReplace,
            skewRetried = skewRetried,
            authRetried = true,
          )
        }
        val errJson = runCatching { JSONObject(text) }.getOrNull()
        if (code == 403 && errJson?.optString("code", "") == "PAY_BLOCKED") {
          BlypShellSession.setPayBlocked(context.applicationContext, true)
          return PayResult(false, message = "pay_blocked")
        }
        val msg = errJson?.optString("message", "")?.ifBlank { null } ?: "http_$code"
        return PayResult(false, message = msg)
      }
      val json = JSONObject(text.ifBlank { "{}" })
      val balance = json.optInt("balanceFcfa", pay.balanceFcfa - amount)
      val txId = json.optString("transactionId", null)?.takeIf { it.isNotBlank() }
      val receiptJson =
        json.optJSONObject("paymentReceipt")?.toString()?.takeIf { it.isNotBlank() }
      BlypShellPayRuntime.updateBalance(context.applicationContext, balance)
      val userPhone = BlypShellSession.phone(context.applicationContext)
      val replaceId = optimisticTxIdToReplace?.trim()?.takeIf { it.isNotEmpty() }
      if (userPhone != null && replaceId != null) {
        BlypTransactionStore.deleteTransaction(context.applicationContext, userPhone, replaceId)
      }
      if (userPhone != null && txId != null) {
        val now = java.time.Instant.now().toString()
        BlypTransactionStore.insertSentTransaction(
          context.applicationContext,
          userPhone,
          txId,
          amount,
          recipientName,
          if (phone.isBlank()) null else phone,
          now,
          txId,
        )
      }
      BlypShellBridge.emitNativePayCompleted(
        amountFcfa = amount,
        balanceFcfa = balance,
        transactionId = txId,
        recipientAccountId = accountId,
        recipientName = recipientName,
        recipientPhone = if (phone.isBlank()) null else phone,
        paymentReceiptJson = receiptJson,
      )
      BlypShellCommerceClient.refreshDossierAfterPaymentAsync(context.applicationContext)
      PayResult(true, balanceFcfa = balance, transactionId = txId)
    } catch (e: Exception) {
      val msg = e.message?.lowercase().orEmpty()
      val network =
        msg.contains("unable to resolve") ||
          msg.contains("failed to connect") ||
          msg.contains("timeout") ||
          msg.contains("network")
      PayResult(false, message = if (network) "network" else (e.message ?: "network"))
    }
  }
}
