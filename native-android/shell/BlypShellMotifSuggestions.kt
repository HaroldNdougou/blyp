package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R
import org.json.JSONObject

/** Propositions de motif, classées par fréquence avec cet interlocuteur. */
object BlypShellMotifSuggestions {
  private const val PREFS = "blyp_shell_motif_suggestions_v1"

  fun defaults(context: Context): List<String> =
    listOf(
      context.getString(R.string.blyp_shell_pay_motif_chip_gift),
      context.getString(R.string.blyp_shell_pay_motif_chip_pocket),
      context.getString(R.string.blyp_shell_pay_motif_chip_surprise),
      context.getString(R.string.blyp_shell_pay_motif_chip_taxi),
      context.getString(R.string.blyp_shell_pay_motif_chip_loan),
    )

  fun ranked(context: Context, conversationId: String): List<String> {
    val base = defaults(context)
    val counts = loadCounts(context, conversationId)
    return base.sortedWith(
      compareByDescending<String> { counts[normalize(it)] ?: 0 }
        .thenBy { base.indexOf(it) },
    )
  }

  fun noteUsed(context: Context, conversationId: String, motif: String) {
    val key = conversationId.trim()
    val label = normalize(motif)
    if (key.isEmpty() || label.isEmpty()) return
    val known = defaults(context).map { normalize(it) }.toSet()
    if (label !in known) return
    val app = context.applicationContext
    val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val root = runCatching { JSONObject(prefs.getString(key, "{}") ?: "{}") }.getOrElse { JSONObject() }
    root.put(label, root.optInt(label, 0) + 1)
    prefs.edit().putString(key, root.toString()).apply()
  }

  private fun loadCounts(context: Context, conversationId: String): Map<String, Int> {
    val key = conversationId.trim()
    if (key.isEmpty()) return emptyMap()
    val raw =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(key, "{}")
        ?: "{}"
    val root = runCatching { JSONObject(raw) }.getOrElse { return emptyMap() }
    val out = HashMap<String, Int>()
    val it = root.keys()
    while (it.hasNext()) {
      val k = it.next()
      out[k] = root.optInt(k, 0)
    }
    return out
  }

  private fun normalize(raw: String): String =
    raw.trim().replace(Regex("\\s+"), " ").lowercase()
}
