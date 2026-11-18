package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ShellCommerceEntry(
  val id: String,
  val name: String,
  val category: String,
  val balanceFcfa: Int,
  val categoryLabel: String = "",
)

object BlypShellCommerceSession {
  private const val PREFS = "blyp_shell_session"
  private const val KEY_COMMERCE_ID = "active_commerce_id"
  private const val KEY_COMMERCE_CATEGORY = "active_commerce_category"
  private const val KEY_COMMERCES_JSON = "commerces_json"
  private const val KEY_CATEGORY_LABELS = "commerce_category_labels"
  private const val KEY_CATEGORY_OVERRIDES = "commerce_category_overrides"
  private const val KEY_PERSONAL_NAME = "personal_display_name"

  fun applyFromUser(context: Context, user: JSONObject) {
    val ctx = user.optJSONObject("activeContext")
    val commerce = ctx?.optString("type", "") == "commerce"
    val commerceId = if (commerce) ctx.optString("commerceId", "").trim() else ""
    val category =
      if (commerce) ctx.optString("category", "").trim().ifEmpty { "other" } else ""
    val pf = user.optString("personalFirstName", "").trim()
    val pl = user.optString("personalLastName", "").trim()
    val personalName =
      listOf(pf, pl).filter { it.isNotEmpty() }.joinToString(" ").ifEmpty {
        listOf(
            user.optString("firstName", "").trim(),
            user.optString("lastName", "").trim(),
          )
          .filter { it.isNotEmpty() }
          .joinToString(" ")
      }
    val commercesArr = user.optJSONArray("commerces") ?: JSONArray()
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_COMMERCE_ID, commerceId)
      .putString(KEY_COMMERCE_CATEGORY, category)
      .putString(KEY_COMMERCES_JSON, commercesArr.toString())
      .putString(KEY_PERSONAL_NAME, personalName.trim())
      .apply()
  }

  fun activeCommerceId(context: Context): String? {
    if (!BlypShellSession.isCommerceMode(context)) return null
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_COMMERCE_ID, "")
      ?.trim()
      ?.ifEmpty { null }
  }

  fun activeCommerceCategory(context: Context): String? {
    if (!BlypShellSession.isCommerceMode(context)) return null
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_COMMERCE_CATEGORY, "")
      ?.trim()
      ?.ifEmpty { null }
  }

  fun isSoaCar(context: Context): Boolean =
    activeCommerceCategory(context) == "soa_car"

  fun personalDisplayName(context: Context): String {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_PERSONAL_NAME, "")
      ?.trim()
      .orEmpty()
      .ifEmpty { "—" }
  }

  fun listCommerces(context: Context): List<ShellCommerceEntry> {
    val raw =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_COMMERCES_JSON, "[]")
        .orEmpty()
    val labels =
      try {
        JSONObject(
          context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CATEGORY_LABELS, "{}")
            .orEmpty()
            .ifBlank { "{}" },
        )
      } catch (_: Exception) {
        JSONObject()
      }
    val overrides =
      try {
        JSONObject(
          context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CATEGORY_OVERRIDES, "{}")
            .orEmpty()
            .ifBlank { "{}" },
        )
      } catch (_: Exception) {
        JSONObject()
      }
    return parseCommerces(raw).map { entry ->
      val saved = labels.optString(entry.id, "").trim()
      val note = entry.categoryLabel.ifBlank { saved }
      val forced = overrides.optString(entry.id, "").trim()
      val category = forced.ifBlank { entry.category }
      if (note == entry.categoryLabel && category == entry.category) entry
      else entry.copy(category = category, categoryLabel = note)
    }
  }

  fun hasAnyCommerce(context: Context): Boolean = listCommerces(context).isNotEmpty()

  /** Garde le type saisi pour « Autre », même si le serveur ne le renvoie pas encore. */
  fun attachCategoryLabel(context: Context, name: String, label: String) {
    val wanted = name.trim()
    val note = label.trim()
    if (wanted.length < 2 || note.length < 2) return
    val prefs =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val arr =
      try {
        JSONArray(prefs.getString(KEY_COMMERCES_JSON, "[]").orEmpty().ifBlank { "[]" })
      } catch (_: Exception) {
        return
      }
    var idx = -1
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val sameName = o.optString("name", "").trim().equals(wanted, ignoreCase = true)
      val other = o.optString("category", "").trim().lowercase() == "other"
      if (sameName && other) idx = i
    }
    if (idx < 0) return
    val row = arr.optJSONObject(idx) ?: return
    row.put("categoryLabel", note)
    val id = row.optString("id", "").trim()
    val labels =
      try {
        JSONObject(prefs.getString(KEY_CATEGORY_LABELS, "{}").orEmpty().ifBlank { "{}" })
      } catch (_: Exception) {
        JSONObject()
      }
    if (id.isNotEmpty()) labels.put(id, note)
    prefs.edit()
      .putString(KEY_COMMERCES_JSON, arr.toString())
      .putString(KEY_CATEGORY_LABELS, labels.toString())
      .apply()
  }

  /** Garde « Commerce de rue » sur ce téléphone si le serveur ne connaît pas encore ce type. */
  fun rememberCategory(context: Context, name: String, category: String) {
    val wanted = name.trim()
    val cat = category.trim().lowercase()
    if (wanted.length < 2 || cat != "street") return
    val prefs =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val arr =
      try {
        JSONArray(prefs.getString(KEY_COMMERCES_JSON, "[]").orEmpty().ifBlank { "[]" })
      } catch (_: Exception) {
        return
      }
    var idx = -1
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("name", "").trim().equals(wanted, ignoreCase = true)) idx = i
    }
    if (idx < 0) return
    val row = arr.optJSONObject(idx) ?: return
    row.put("category", cat)
    val id = row.optString("id", "").trim()
    val overrides =
      try {
        JSONObject(prefs.getString(KEY_CATEGORY_OVERRIDES, "{}").orEmpty().ifBlank { "{}" })
      } catch (_: Exception) {
        JSONObject()
      }
    if (id.isNotEmpty()) overrides.put(id, cat)
    prefs.edit()
      .putString(KEY_COMMERCES_JSON, arr.toString())
      .putString(KEY_CATEGORY_OVERRIDES, overrides.toString())
      .apply()
  }

  fun clearCategoryOverride(context: Context, commerceId: String) {
    val id = commerceId.trim()
    if (id.isEmpty()) return
    val prefs =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val overrides =
      try {
        JSONObject(prefs.getString(KEY_CATEGORY_OVERRIDES, "{}").orEmpty().ifBlank { "{}" })
      } catch (_: Exception) {
        return
      }
    if (!overrides.has(id)) return
    overrides.remove(id)
    prefs.edit().putString(KEY_CATEGORY_OVERRIDES, overrides.toString()).apply()
  }

  /** Crédit immédiat d’un commerce, sans attendre le serveur. */
  fun addBalance(context: Context, commerceId: String, deltaFcfa: Int) {
    if (deltaFcfa == 0) return
    val id = commerceId.trim()
    if (id.isEmpty()) return
    val prefs =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_COMMERCES_JSON, "[]").orEmpty()
    val arr =
      try {
        JSONArray(raw.ifBlank { "[]" })
      } catch (_: Exception) {
        return
      }
    var changed = false
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("id", "").trim() != id) continue
      o.put("balanceFcfa", (o.optInt("balanceFcfa", 0) + deltaFcfa).coerceAtLeast(0))
      changed = true
    }
    if (!changed) return
    prefs.edit().putString(KEY_COMMERCES_JSON, arr.toString()).apply()
  }

  fun activeCommerceName(context: Context): String {
    val id = activeCommerceId(context) ?: return "—"
    val listed = listCommerces(context).firstOrNull { it.id == id }?.name?.trim().orEmpty()
    if (listed.isNotEmpty() && listed != "[object Object]") return listed
    val profile = BlypShellSession.profile(context)?.displayName?.trim().orEmpty()
    if (profile.isNotEmpty() && profile != "—" && profile != "[object Object]") return profile
    return "—"
  }

  private fun parseCommerces(raw: String): List<ShellCommerceEntry> {
    return try {
      val arr = JSONArray(raw.ifBlank { "[]" })
      val out = ArrayList<ShellCommerceEntry>()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val id = o.optString("id", "").trim()
        val name = o.optString("name", "").trim()
        if (id.isEmpty() || name.isEmpty()) continue
        out.add(
          ShellCommerceEntry(
            id = id,
            name = name,
            category = o.optString("category", "other").trim().ifEmpty { "other" },
            balanceFcfa = o.optInt("balanceFcfa", 0).coerceAtLeast(0),
            categoryLabel = o.optString("categoryLabel", "").trim(),
          ),
        )
      }
      out
    } catch (_: Exception) {
      emptyList()
    }
  }
}
