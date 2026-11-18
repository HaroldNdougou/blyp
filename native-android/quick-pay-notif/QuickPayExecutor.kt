package com.haroldndougou.blyp.quickpaynotif

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object QuickPayExecutor {
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
  ) {
    io.execute {
      val result = paySync(context, amountFcfa)
      onDone(result)
    }
  }

  fun paySync(context: Context, amountFcfa: Int): PayResult {
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) return PayResult(false, message = "invalid_amount")
    val snap = QuickPayNativeSecrets.read(context)
      ?: return PayResult(false, message = "not_configured")
    if (amount > snap.balanceFcfa) {
      return PayResult(false, message = "insufficient_balance")
    }
    return try {
      val recipient = JSONObject(snap.recipientJson)
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
          put("transactionPin", snap.transactionPin)
        }
      val url = URL("${snap.apiBaseUrl}/payments/pay")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 20_000
        readTimeout = 25_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty(
          "Authorization",
          "Bearer ${com.haroldndougou.blyp.shell.BlypShellSessionRefresh.accessForSignedPay(context) ?: snap.accessToken}",
        )
      }
      val bodyText = body.toString()
      com.haroldndougou.blyp.shell.BlypShellDeviceKey.applyProof(conn, snap.apiBaseUrl, "POST", bodyText)
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write(bodyText)
      }
      val code = conn.responseCode
      com.haroldndougou.blyp.shell.BlypShellDeviceKey.noteServerDate(conn)
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val text =
        stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
      conn.disconnect()
      if (code !in 200..299) {
        val msg =
          runCatching { JSONObject(text).optString("message", "") }
            .getOrDefault("")
            .ifBlank { "http_$code" }
        return PayResult(false, message = msg)
      }
      val json = JSONObject(text.ifBlank { "{}" })
      val balance = json.optInt("balanceFcfa", snap.balanceFcfa - amount)
      val txId = json.optString("transactionId", null)?.takeIf { it.isNotBlank() }
      QuickPayNativeSecrets.updateBalance(context, balance)
      val app = context.applicationContext
      com.haroldndougou.blyp.shell.BlypShellPayRuntime.updateBalance(app, balance)
      val userPhone = com.haroldndougou.blyp.shell.BlypShellSession.phone(app)
      if (userPhone != null && txId != null) {
        com.haroldndougou.blyp.shell.BlypTransactionStore.insertSentTransaction(
          app,
          userPhone,
          txId,
          amount,
          recipientName,
          if (phone.isBlank()) null else phone,
          java.time.Instant.now().toString(),
          txId,
        )
      }
      com.haroldndougou.blyp.shell.BlypShellUiRefresh.notifyWalletChanged()
      com.haroldndougou.blyp.shell.BlypShellCommerceClient.refreshDossierAfterPaymentAsync(app)
      PayResult(true, balanceFcfa = balance, transactionId = txId)
    } catch (e: Exception) {
      PayResult(false, message = e.message ?: "network")
    }
  }
}
