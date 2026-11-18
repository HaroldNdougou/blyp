package com.haroldndougou.blyp.shell

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Périodes compte rendu Soa — fuseau Douala (aligné `lib/soa/soaReportPeriod.ts`). */
object BlypShellSoaPeriod {
  enum class Kind { DAY, WEEK, MONTH }

  private val ZONE = ZoneId.of("Africa/Douala")
  private val DAY_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd")

  fun todayKey(): String = BlypShellSoaDayKey.todayKey()

  fun shiftDayKey(dayKey: String, deltaDays: Int): String {
    val base = Instant.parse("${dayKey.trim()}T12:00:00+01:00")
    return DAY_FMT.format(base.atZone(ZONE).plusDays(deltaDays.toLong()))
  }

  fun recentDayKeys(count: Int = 14): List<String> {
    val out = ArrayList<String>()
    var dk = todayKey()
    repeat(count) {
      out.add(dk)
      dk = shiftDayKey(dk, -1)
    }
    return out
  }

  fun weekdayMon0Douala(dayKey: String): Int {
    val dow =
      java.time.LocalDate.parse(dayKey.trim(), DAY_FMT).atStartOfDay(ZONE).dayOfWeek
    return (dow.value + 6) % 7
  }

  fun weekStartDayKey(dayKey: String): String {
    var dk = dayKey.trim()
    repeat(weekdayMon0Douala(dk)) {
      dk = shiftDayKey(dk, -1)
    }
    return dk
  }

  fun dayKeysForWeek(weekStartDayKey: String): List<String> {
    val today = todayKey()
    val keys = ArrayList<String>()
    var dk = weekStartDayKey.trim()
    repeat(7) {
      if (dk > today) return keys
      keys.add(dk)
      dk = shiftDayKey(dk, 1)
    }
    return keys
  }

  fun recentWeekStarts(count: Int = 8): List<String> {
    val out = ArrayList<String>()
    var start = weekStartDayKey(todayKey())
    repeat(count) {
      out.add(start)
      start = shiftDayKey(start, -7)
    }
    return out
  }

  fun monthKeyFromDayKey(dayKey: String): String = dayKey.trim().take(7)

  fun dayKeysInMonth(monthKey: String): List<String> {
    val mk = monthKey.trim()
    val today = todayKey()
    val keys = ArrayList<String>()
    var dk = "$mk-01"
    while (monthKeyFromDayKey(dk) == mk) {
      if (dk > today) break
      keys.add(dk)
      val next = shiftDayKey(dk, 1)
      if (monthKeyFromDayKey(next) != mk) break
      dk = next
    }
    return keys
  }

  fun recentMonthKeys(count: Int = 6): List<String> {
    val out = ArrayList<String>()
    var mk = monthKeyFromDayKey(todayKey())
    repeat(count) {
      out.add(mk)
      mk = monthKeyFromDayKey(shiftDayKey("$mk-01", -1))
    }
    return out
  }

  fun dayKeysForKind(kind: Kind, periodKey: String): List<String> =
    when (kind) {
      Kind.DAY -> listOf(periodKey.trim())
      Kind.WEEK -> dayKeysForWeek(periodKey)
      Kind.MONTH -> dayKeysInMonth(periodKey)
    }

  fun formatPeriodLabel(context: android.content.Context, kind: Kind, periodKey: String): String {
    val fr = Locale.getDefault().language == "fr"
    return when (kind) {
      Kind.DAY -> periodKey
      Kind.WEEK -> {
        val start = periodKey.trim()
        val end = shiftDayKey(start, 6)
        if (fr) "$start → $end" else "$start – $end"
      }
      Kind.MONTH -> {
        val parts = periodKey.trim().split("-")
        if (parts.size < 2) return periodKey
        val y = parts[0].toIntOrNull() ?: return periodKey
        val m = parts[1].toIntOrNull() ?: return periodKey
        val month =
          java.time.Month.of(m.coerceIn(1, 12))
            .getDisplayName(TextStyle.FULL, if (fr) Locale.FRENCH else Locale.US)
        if (fr) "$month $y" else "$month $y"
      }
    }
  }
}
