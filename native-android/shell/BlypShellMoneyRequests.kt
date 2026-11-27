package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Demande de recharge ou de retrait, identifiée par son numéro, confirmée par l'admin. */
object BlypShellMoneyRequests {
  private const val PREFS = "blyp_money_requests"
  private const val KEY = "items"
  private val main = Handler(Looper.getMainLooper())
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()
  private val json = "application/json; charset=utf-8".toMediaType()

  fun record(context: Context, kind: String, amountFcfa: Int) {
    if (amountFcfa <= 0) return
    val app = context.applicationContext
    val id = UUID.randomUUID().toString()
    val phone = BlypShellSession.phone(app).orEmpty()
    val now = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply {
      timeZone = java.util.TimeZone.getTimeZone("UTC")
    }.format(java.util.Date())
    val row = JSONObject()
      .put("id", id)
      .put("kind", kind)
      .put("amount", amountFcfa)
      .put("phone", phone)
      .put("status", "pending")
      .put("createdAt", now)
      .put("applied", false)
      .put("posted", false)
    val all = read(app)
    all.put(row)
    write(app, all)
    Thread {
      if (postOne(app, row)) {
        val saved = read(app)
        find(saved, id)?.put("posted", true)
        write(app, saved)
      }
      pull(app)
    }.start()
  }

  fun pullAsync(context: Context) {
    val app = context.applicationContext
    Thread { pull(app) }.start()
  }

  private fun postOne(app: Context, row: JSONObject): Boolean {
    val runtime = BlypShellRuntime.readFresh(app) ?: return false
    val body = JSONObject()
      .put("requestId", row.getString("id"))
      .put("kind", row.getString("kind"))
      .put("amount", row.getInt("amount"))
      .put("phone", row.optString("phone"))
    val req = Request.Builder()
      .url("${runtime.apiBaseUrl.trimEnd('/')}/wallet/money-requests")
      .header("Authorization", "Bearer ${runtime.accessToken}")
      .post(body.toString().toRequestBody(json))
      .build()
    return try {
      http.newCall(req).execute().use { it.isSuccessful }
    } catch (_: Exception) {
      false
    }
  }

  private fun pull(app: Context) {
    val localFirst = read(app)
    var postedChange = false
    for (i in 0 until localFirst.length()) {
      val row = localFirst.optJSONObject(i) ?: continue
      if (row.optBoolean("posted") || row.optString("status") != "pending") continue
      if (postOne(app, row)) {
        row.put("posted", true)
        postedChange = true
      }
    }
    if (postedChange) write(app, localFirst)
    val runtime = BlypShellRuntime.readFresh(app) ?: return
    val req = Request.Builder()
      .url("${runtime.apiBaseUrl.trimEnd('/')}/wallet/money-requests")
      .header("Authorization", "Bearer ${runtime.accessToken}")
      .get()
      .build()
    val text = try {
      http.newCall(req).execute().use { res -> if (!res.isSuccessful) return else res.body?.string().orEmpty() }
    } catch (_: Exception) {
      return
    }
    val items = try {
      JSONObject(text).optJSONArray("items") ?: return
    } catch (_: Exception) {
      return
    }
    val local = read(app)
    var changed = false
    var balance: Int? = null
    for (i in 0 until items.length()) {
      val remote = items.optJSONObject(i) ?: continue
      val id = remote.optString("requestId")
      if (id.isEmpty()) continue
      val status = remote.optString("status")
      val row = find(local, id) ?: continue
      if (row.optString("status") != status) {
        row.put("status", status)
        changed = true
      }
      if (status == "confirmed" && !row.optBoolean("applied")) {
        val amount = remote.optInt("amountFcfa", row.optInt("amount"))
        val phone = row.optString("phone").ifEmpty { BlypShellSession.phone(app).orEmpty() }
        val at = remote.optString("confirmedAt").ifEmpty { row.optString("createdAt") }
        val tx = remote.optString("transactionId").ifEmpty { id }
        if (row.optString("kind") == "deposit") {
          BlypTransactionStore.insertReceivedTransaction(app, phone, tx, amount, "Recharge", phone, at, tx)
        } else {
          BlypTransactionStore.insertSentTransaction(app, phone, tx, amount, "Retrait", phone, at, tx)
        }
        row.put("applied", true)
        changed = true
        if (remote.has("balanceAfterFcfa")) balance = remote.optInt("balanceAfterFcfa")
      }
    }
    if (changed) write(app, local)
    if (balance != null) {
      val next = balance
      main.post {
        BlypShellSession.updateBalance(app, next)
        BlypShellUiRefresh.notifyWalletChanged()
      }
    } else if (changed) {
      main.post { BlypShellUiRefresh.notifyWalletChanged() }
    }
  }

  private fun find(all: JSONArray, id: String): JSONObject? {
    for (i in 0 until all.length()) {
      val row = all.optJSONObject(i) ?: continue
      if (row.optString("id") == id) return row
    }
    return null
  }

  private fun read(app: Context): JSONArray {
    val raw = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]").orEmpty()
    return try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  private fun write(app: Context, all: JSONArray) {
    val keep = JSONArray()
    val start = (all.length() - 40).coerceAtLeast(0)
    for (i in start until all.length()) all.optJSONObject(i)?.let { keep.put(it) }
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, keep.toString()).apply()
  }
}
