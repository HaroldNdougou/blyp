package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

object BlypShellDepositExecutor {
  private val io = Executors.newSingleThreadExecutor()

  data class InitResult(
    val ok: Boolean,
    val completed: Boolean = false,
    val balanceFcfa: Int = 0,
    val depositIntentId: String? = null,
    val message: String? = null,
  )

  data class StatusResult(
    val status: String,
    val balanceFcfa: Int = 0,
    val message: String? = null,
  )

  fun newIdempotencyKey(): String = UUID.randomUUID().toString()

  fun depositAsync(
    context: Context,
    amountFcfa: Int,
    idempotencyKey: String,
    onDone: (InitResult) -> Unit,
  ) {
    io.execute { onDone(depositSync(context, amountFcfa, idempotencyKey)) }
  }

  fun depositSync(
    context: Context,
    amountFcfa: Int,
    idempotencyKey: String,
  ): InitResult {
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) return InitResult(false, message = "invalid_amount")
    val runtime = BlypShellRuntime.readFresh(context.applicationContext)
      ?: return InitResult(false, message = "not_configured")
    return try {
      val body =
        JSONObject().apply {
          put("amount", amount)
        }
      val url = URL("${runtime.apiBaseUrl}/wallet/deposit")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 25_000
        readTimeout = 35_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        setRequestProperty("Idempotency-Key", idempotencyKey.trim())
      }
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
      if (code !in 200..299) {
        val msg =
          runCatching { JSONObject(text).optString("message", "") }
            .getOrDefault("")
            .ifBlank { "http_$code" }
        return InitResult(false, message = msg)
      }
      val json = JSONObject(text.ifBlank { "{}" })
      val status = json.optString("status", "").trim()
      if (status == "completed") {
        val balance = json.optInt("balanceFcfa", -1)
        if (balance >= 0) {
          BlypShellPayRuntime.updateBalance(context.applicationContext, balance)
        }
        return InitResult(true, completed = true, balanceFcfa = balance.coerceAtLeast(0))
      }
      val intentId = json.optString("depositIntentId", "").trim()
      if (status == "pending_provider" && intentId.isNotEmpty()) {
        return InitResult(true, completed = false, depositIntentId = intentId)
      }
      InitResult(false, message = "unexpected_response")
    } catch (e: Exception) {
      InitResult(false, message = e.message ?: "network")
    }
  }

  fun statusSync(
    context: Context,
    depositIntentId: String,
    syncRemote: Boolean,
  ): StatusResult {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext)
      ?: return StatusResult("error", message = "not_configured")
    val id = depositIntentId.trim()
    if (id.isEmpty()) return StatusResult("error", message = "invalid_id")
    return try {
      val q = if (syncRemote) "" else "?sync=0"
      val url = URL("${runtime.apiBaseUrl}/wallet/deposits/$id$q")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 20_000
        readTimeout = 25_000
        setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
      }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val text =
        stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
      conn.disconnect()
      if (code !in 200..299) {
        return StatusResult("error", message = "http_$code")
      }
      val json = JSONObject(text.ifBlank { "{}" })
      val status = json.optString("status", "pending_provider")
      if (status == "completed") {
        val balance = json.optInt("balanceFcfa", -1)
        if (balance >= 0) {
          BlypShellPayRuntime.updateBalance(context.applicationContext, balance)
        }
        return StatusResult("completed", balanceFcfa = balance.coerceAtLeast(0))
      }
      if (status == "failed") {
        val reason = json.optString("failureReason", "").trim()
        return StatusResult("failed", message = reason.ifBlank { "failed" })
      }
      StatusResult("pending_provider")
    } catch (e: Exception) {
      StatusResult("error", message = e.message ?: "network")
    }
  }
}
