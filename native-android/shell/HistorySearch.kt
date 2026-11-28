package com.haroldndougou.blyp.shell

import android.content.Context
import java.time.Instant
import java.time.temporal.ChronoUnit

/** Recherche et filtres locaux sur l’historique (cache-first). */
object HistorySearch {
  private const val PREFS = "blyp_shell_history_search_v1"
  private const val KEY_TEXT = "text"
  private const val KEY_DATE = "date"
  private const val KEY_MIN = "min"
  private const val KEY_MAX = "max"

  enum class DateWindow {
    ALL,
    D7,
    D30,
    D90,
  }

  data class Query(
    val text: String = "",
    val date: DateWindow = DateWindow.ALL,
    val minAmount: Int? = null,
    val maxAmount: Int? = null,
  ) {
    val isEmpty: Boolean
      get() =
        text.isBlank() &&
          date == DateWindow.ALL &&
          minAmount == null &&
          maxAmount == null
  }

  fun load(context: Context): Query {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val date =
      runCatching { DateWindow.valueOf(p.getString(KEY_DATE, DateWindow.ALL.name)!!) }
        .getOrDefault(DateWindow.ALL)
    val min = p.getInt(KEY_MIN, -1).takeIf { it >= 0 }
    val max = p.getInt(KEY_MAX, -1).takeIf { it >= 0 }
    return Query(
      text = p.getString(KEY_TEXT, "").orEmpty(),
      date = date,
      minAmount = min,
      maxAmount = max,
    )
  }

  fun save(context: Context, query: Query) {
    context
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_TEXT, query.text)
      .putString(KEY_DATE, query.date.name)
      .putInt(KEY_MIN, query.minAmount ?: -1)
      .putInt(KEY_MAX, query.maxAmount ?: -1)
      .apply()
  }

  fun apply(items: List<ShellHistoryItem>, query: Query): List<ShellHistoryItem> {
    if (query.isEmpty) return items
    val needle = query.text.trim().lowercase()
    val cutoff =
      when (query.date) {
        DateWindow.ALL -> null
        DateWindow.D7 -> Instant.now().minus(7, ChronoUnit.DAYS)
        DateWindow.D30 -> Instant.now().minus(30, ChronoUnit.DAYS)
        DateWindow.D90 -> Instant.now().minus(90, ChronoUnit.DAYS)
      }
    val out = ArrayList<ShellHistoryItem>()
    var pendingHeader: ShellHistoryItem.Header? = null
    for (item in items) {
      when (item) {
        is ShellHistoryItem.Header -> pendingHeader = item
        is ShellHistoryItem.Row -> {
          if (!matches(item.row, needle, cutoff, query.minAmount, query.maxAmount)) continue
          pendingHeader?.let {
            out.add(it)
            pendingHeader = null
          }
          out.add(item)
        }
      }
    }
    return out
  }

  private fun matches(
    row: ShellHistoryRow,
    needle: String,
    cutoff: Instant?,
    minAmount: Int?,
    maxAmount: Int?,
  ): Boolean {
    if (minAmount != null && row.amountFcfa < minAmount) return false
    if (maxAmount != null && row.amountFcfa > maxAmount) return false
    if (cutoff != null) {
      val at =
        try {
          Instant.parse(row.createdAt)
        } catch (_: Exception) {
          null
        }
      if (at == null || at.isBefore(cutoff)) return false
    }
    if (needle.isEmpty()) return true
    val hay =
      buildString {
        append(row.name)
        append(' ')
        append(row.amountLabel)
        append(' ')
        append(row.amountFcfa)
        append(' ')
        append(row.note.orEmpty())
        append(' ')
        append(row.reference.orEmpty())
        append(' ')
        append(row.counterpartyPhone.orEmpty())
        append(' ')
        append(row.dateLabel)
      }
        .lowercase()
    if (hay.contains(needle)) return true
    val digits = needle.filter { it.isDigit() }
    return digits.isNotEmpty() &&
      (row.amountFcfa.toString().contains(digits) ||
        row.reference.orEmpty().contains(digits) ||
        row.counterpartyPhone.orEmpty().contains(digits))
  }
}
