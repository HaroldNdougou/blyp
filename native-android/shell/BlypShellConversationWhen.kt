package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Aligné `formatConversationWhen` (liste discussions). */
object BlypShellConversationWhen {
  private fun localDateTime(iso: String): java.time.LocalDateTime? {
    val trimmed = iso.trim()
    return try {
      java.time.OffsetDateTime.parse(trimmed)
        .atZoneSameInstant(ZoneId.systemDefault())
        .toLocalDateTime()
    } catch (_: Exception) {
      try {
        java.time.LocalDateTime.parse(trimmed.take(19))
      } catch (_: Exception) {
        null
      }
    }
  }

  fun format(context: Context, iso: String?): String {
    val raw = iso?.trim().orEmpty()
    if (raw.isEmpty()) return ""
    val dt = localDateTime(raw) ?: return raw.take(10)
    val day = dt.toLocalDate()
    val today = LocalDate.now()
    val hm = "%02d:%02d".format(dt.hour, dt.minute)
    return when {
      day.isEqual(today) -> hm
      day.isEqual(today.minusDays(1)) ->
        context.getString(
          R.string.blyp_shell_date_at,
          context.getString(R.string.blyp_shell_date_yesterday),
          hm,
        )
      else -> {
        val loc = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
        val pattern = if (day.year != today.year) "d MMM yyyy" else "d MMM"
        val date = dt.format(DateTimeFormatter.ofPattern(pattern, loc))
        context.getString(R.string.blyp_shell_date_at, date, hm)
      }
    }
  }
}