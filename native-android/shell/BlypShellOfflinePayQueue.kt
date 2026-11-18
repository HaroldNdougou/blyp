package com.haroldndougou.blyp.shell

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Paiements coque en attente (réseau) — snapshot destinataire + clé idempotence. */
object BlypShellOfflinePayQueue {
  private const val PREFS = "blyp_shell_offline_pay_v3"
  private const val KEY_ITEMS = "items_json"
  private const val MAX = 12

  private fun prefs(context: Context) = BlypSecurePrefs.get(context, PREFS)

  fun pendingCount(context: Context): Int = loadItems(context).length()

  fun enqueue(
    context: Context,
    amountFcfa: Int,
    idempotencyKey: String,
    recipientJson: String,
  ) {
    enqueueInternal(
      context,
      JSONObject().apply {
        put("idempotencyKey", idempotencyKey.trim().ifEmpty { UUID.randomUUID().toString() })
        put("amountFcfa", amountFcfa)
        put("recipientJson", recipientJson.trim())
        put("createdAtMs", System.currentTimeMillis())
        put("balanceBeforeFcfa", 0)
        put("optimisticTxId", JSONObject.NULL)
        put("cashierSession", JSONObject.NULL)
      },
    )
  }

  fun enqueueCommerceInstant(
    context: Context,
    amountFcfa: Int,
    idempotencyKey: String,
    recipientJson: String,
    balanceBeforeFcfa: Int,
    optimisticTxId: String,
  ) {
    enqueueInternal(
      context,
      JSONObject().apply {
        put("idempotencyKey", idempotencyKey.trim())
        put("amountFcfa", amountFcfa)
        put("recipientJson", recipientJson.trim())
        put("createdAtMs", System.currentTimeMillis())
        put("balanceBeforeFcfa", balanceBeforeFcfa.coerceAtLeast(0))
        put("optimisticTxId", optimisticTxId.trim())
        put("cashierSession", JSONObject.NULL)
      },
    )
  }

  fun patchCashierSession(context: Context, idempotencyKey: String, session: Int) {
    val key = idempotencyKey.trim()
    if (key.isEmpty()) return
    val arr = loadItems(context)
    var changed = false
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("idempotencyKey") != key) continue
      o.put("cashierSession", session)
      changed = true
      break
    }
    if (changed) {
      prefs(context).edit().putString(KEY_ITEMS, arr.toString()).apply()
    }
  }

  private fun enqueueInternal(context: Context, row: JSONObject) {
    val amount = row.optInt("amountFcfa", 0)
    val recipient = row.optString("recipientJson", "").trim()
    if (amount <= 0 || recipient.isBlank()) return
    val key = row.optString("idempotencyKey", "").trim().ifEmpty { UUID.randomUUID().toString() }
    row.put("idempotencyKey", key)
    val arr = loadItems(context)
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("idempotencyKey") == key) return
    }
    val next = JSONArray()
    next.put(row)
    val limit = minOf(arr.length(), MAX - 1)
    for (i in 0 until limit) {
      next.put(arr.optJSONObject(i))
    }
    prefs(context).edit().putString(KEY_ITEMS, next.toString()).apply()
    BlypShellUiRefresh.notifyWalletChanged()
  }

  fun flush(context: Context) {
    if (BlypShellRuntime.read(context) == null) return
    if (!BlypShellNetwork.isOnline(context)) return
    val p = prefs(context)
    val arr = loadItems(context)
    if (arr.length() == 0) return
    val remaining = JSONArray()
    var sentAny = false
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val amount = o.optInt("amountFcfa", 0)
      val recipient = o.optString("recipientJson", "").trim()
      val idem = o.optString("idempotencyKey", "").trim()
      val balanceBefore = o.optInt("balanceBeforeFcfa", 0)
      val optimisticTxId = o.optString("optimisticTxId", "").trim()
      val sessionRaw = o.opt("cashierSession")
      val cashierSession =
        if (sessionRaw == null || sessionRaw == JSONObject.NULL) null
        else o.optInt("cashierSession", 0).takeIf { it > 0 }
      if (amount <= 0 || recipient.isBlank()) continue
      val result =
        BlypShellPayExecutor.paySync(
          context,
          amount,
          recipient,
          idem.ifEmpty { null },
          cashierSession = cashierSession,
          optimisticTxIdToReplace = optimisticTxId.ifEmpty { null },
        )
      if (result.ok) {
        sentAny = true
        continue
      }
      if (BlypShellNetwork.isRetryablePayFailure(result.message)) {
        remaining.put(o)
        break
      }
      if (balanceBefore > 0) {
        BlypShellPayRuntime.updateBalance(context, balanceBefore)
        BlypShellUiRefresh.notifyWalletChanged()
      }
      val phone = BlypShellSession.phone(context)
      if (!phone.isNullOrEmpty() && optimisticTxId.isNotEmpty()) {
        BlypTransactionStore.deleteTransaction(context, phone, optimisticTxId)
      }
      sentAny = true
    }
    p.edit().putString(KEY_ITEMS, remaining.toString()).apply()
    if (sentAny) {
      BlypShellUiRefresh.notifyWalletChanged()
    }
  }

  fun clearAll(context: Context) {
    prefs(context).edit().putString(KEY_ITEMS, "[]").apply()
    BlypShellUiRefresh.notifyWalletChanged()
  }

  private fun loadItems(context: Context): JSONArray {
    val raw = prefs(context).getString(KEY_ITEMS, "[]").orEmpty()
    return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
  }
}
