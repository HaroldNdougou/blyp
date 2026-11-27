package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ShellCommerceStamp(
  val line1: String,
  val line2: String,
  val shape: String,
  val color: String,
  val updatedAt: String,
)

object BlypShellCommerceStampStore {
  private const val KEY_PREFIX = "receipt_stamp:"
  private const val REGISTRY_KEY = "receipt_stamp_registry"

  fun scopeKey(userId: String, commerceId: String?): String {
    val uid = userId.trim()
    val cid = commerceId?.trim().orEmpty()
    if (uid.isEmpty()) return ""
    return if (cid.isNotEmpty()) "$uid::commerce::$cid" else "$uid::personal"
  }

  private fun fingerprint(stamp: ShellCommerceStamp): String {
    val line1 = stamp.line1.trim().lowercase()
    val line2 = stamp.line2.trim().lowercase()
    return "${stamp.shape}|${stamp.color}|$line1|$line2"
  }

  fun load(context: Context, userId: String, commerceId: String?): ShellCommerceStamp? {
    val scope = scopeKey(userId, commerceId)
    if (scope.isEmpty()) return null
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return null
    val raw = readKv(context, phone, "$KEY_PREFIX$scope") ?: return null
    return try {
      val o = JSONObject(raw)
      val line1 = o.optString("line1").trim()
      if (line1.isEmpty()) return null
      ShellCommerceStamp(
        line1 = line1,
        line2 = o.optString("line2").trim(),
        shape = if (o.optString("shape") == "line") "line" else "circle",
        color = if (o.optString("color") == "blue") "blue" else "red",
        updatedAt = o.optString("updatedAt").trim(),
      )
    } catch (_: Exception) {
      null
    }
  }

  sealed class SaveResult {
    data class Ok(val stamp: ShellCommerceStamp) : SaveResult()
    data object Duplicate : SaveResult()
    data object Invalid : SaveResult()
  }

  fun save(
    context: Context,
    userId: String,
    commerceId: String?,
    line1: String,
    line2: String,
    shape: String,
    color: String,
  ): SaveResult {
    val scope = scopeKey(userId, commerceId)
    val l1 = line1.trim()
    if (scope.isEmpty() || l1.isEmpty()) return SaveResult.Invalid
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return SaveResult.Invalid
    val stamp =
      ShellCommerceStamp(
        line1 = l1,
        line2 = line2.trim(),
        shape = if (shape == "line") "line" else "circle",
        color = if (color == "blue") "blue" else "red",
        updatedAt = java.time.Instant.now().toString(),
      )
    val fp = fingerprint(stamp)
    val registry = JSONArray(readKv(context, phone, REGISTRY_KEY) ?: "[]")
    for (i in 0 until registry.length()) {
      val e = registry.optJSONObject(i) ?: continue
      if (e.optString("fingerprint") == fp && e.optString("scope") != scope) {
        return SaveResult.Duplicate
      }
    }
    val nextReg = JSONArray()
    for (i in 0 until registry.length()) {
      val e = registry.optJSONObject(i) ?: continue
      if (e.optString("scope") != scope) nextReg.put(e)
    }
    nextReg.put(JSONObject().put("fingerprint", fp).put("scope", scope))
    val stampJson =
      JSONObject()
        .put("line1", stamp.line1)
        .put("line2", stamp.line2)
        .put("shape", stamp.shape)
        .put("color", stamp.color)
        .put("updatedAt", stamp.updatedAt)
    writeKv(context, phone, REGISTRY_KEY, nextReg.toString())
    writeKv(context, phone, "$KEY_PREFIX$scope", stampJson.toString())
    return SaveResult.Ok(stamp)
  }

  private fun readKv(context: Context, phone: String, key: String): String? {
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return null
    return try {
      db.rawQuery(
        "SELECT json FROM kv_cache WHERE phone = ? AND key = ? LIMIT 1",
        arrayOf(phone, key),
      ).use { c ->
        if (!c.moveToFirst()) return null
        c.getString(0)?.trim().orEmpty().ifEmpty { null }
      }
    } catch (_: Exception) {
      null
    } finally {
      db.close()
    }
  }

  private fun writeKv(context: Context, phone: String, key: String, json: String) {
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return
    try {
      db.execSQL(
        "INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)",
        arrayOf(phone, key, json),
      )
    } catch (_: Exception) {
    } finally {
      db.close()
    }
  }
}