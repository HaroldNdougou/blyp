package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R
import java.io.File
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object BlypShellSoaReportExport {
  data class OrderedTrip(
    val trip: ShellSoaDayReportTrip,
    val courseNumber: Int?,
  )

  fun orderTrips(trips: List<ShellSoaDayReportTrip>): List<OrderedTrip> {
    val completed =
      trips.filter { !it.isActive }.sortedBy { parseMs(it.tripStartedAt) }
    val active = trips.filter { it.isActive }
    val out = ArrayList<OrderedTrip>()
    completed.forEachIndexed { i, t -> out.add(OrderedTrip(t, i + 1)) }
    active.forEach { t -> out.add(OrderedTrip(t, null)) }
    return out
  }

  private fun parseMs(iso: String): Long {
    return try {
      Instant.parse(iso).toEpochMilli()
    } catch (_: Exception) {
      0L
    }
  }

  private fun formatAmount(n: Int, locale: Locale): String {
    return NumberFormat.getIntegerInstance(locale).format(n.coerceAtLeast(0))
  }

  private fun isFr(context: Context): Boolean =
    Locale.getDefault().language == "fr"

  fun buildPlainText(
    context: Context,
    commerceName: String,
    report: ShellSoaDayReport,
  ): String {
    val fr = isFr(context)
    val loc = if (fr) Locale.FRENCH else Locale.US
    val ordered = orderTrips(report.trips)
    val completedCount = ordered.count { !it.trip.isActive }
    val lines = ArrayList<String>()
    lines.add(context.getString(R.string.blyp_shell_soa_report_title))
    lines.add(
      "${context.getString(R.string.blyp_shell_soa_report_commerce)}: ${commerceName.trim()}",
    )
    lines.add(
      "${context.getString(R.string.blyp_shell_soa_report_day)}: ${report.dayKey}",
    )
    lines.add(
      "${context.getString(R.string.blyp_shell_soa_report_total)}: ${formatAmount(report.totalFcfa, loc)} ${context.getString(R.string.blyp_shell_history_fcfa)}",
    )
    lines.add(
      "${context.getString(R.string.blyp_shell_soa_report_trips_done)}: ${String.format(loc, "%02d", completedCount)}",
    )
    lines.add("")
    lines.add(context.getString(R.string.blyp_shell_soa_report_trip_list))
    if (ordered.isEmpty()) {
      lines.add(context.getString(R.string.blyp_shell_soa_report_no_trips))
    } else {
      for (row in ordered) {
        val status =
          when {
            row.trip.isActive -> context.getString(R.string.blyp_shell_soa_report_trip_active)
            row.courseNumber != null ->
              context.getString(R.string.blyp_shell_soa_report_trip_n, row.courseNumber)
            else -> context.getString(R.string.blyp_shell_soa_report_trip_line)
          }
        lines.add(
          "- $status · ${formatAmount(row.trip.totalFcfa, loc)} ${context.getString(R.string.blyp_shell_history_fcfa)}",
        )
      }
    }
    lines.add("")
    val gen =
      DateTimeFormatter.ofPattern(if (fr) "dd/MM/yyyy HH:mm" else "MM/dd/yyyy HH:mm")
        .withLocale(loc)
        .withZone(ZoneId.systemDefault())
        .format(Instant.now())
    lines.add("${context.getString(R.string.blyp_shell_soa_report_generated)}: $gen")
    return lines.joinToString("\n")
  }

  fun writeCsvFile(
    context: Context,
    report: ShellSoaDayReport,
    commerceId: String,
  ): File? {
    val fr = isFr(context)
    val ordered = orderTrips(report.trips)
    val header =
      listOf(
        context.getString(R.string.blyp_shell_soa_report_csv_course),
        context.getString(R.string.blyp_shell_soa_report_csv_status),
        context.getString(R.string.blyp_shell_soa_report_csv_total),
        context.getString(R.string.blyp_shell_soa_report_csv_started),
        context.getString(R.string.blyp_shell_soa_report_csv_ended),
      ).joinToString(",") { csvEscape(it) }
    val rows =
      ordered.joinToString("\n") { row ->
        val course =
          when {
            row.courseNumber != null -> row.courseNumber.toString()
            else -> row.trip.tripId
          }
        val status =
          if (row.trip.isActive) {
            context.getString(R.string.blyp_shell_soa_report_trip_active)
          } else {
            context.getString(R.string.blyp_shell_soa_report_csv_done)
          }
        listOf(
          course,
          status,
          row.trip.totalFcfa.toString(),
          row.trip.tripStartedAt,
          row.trip.endedAt ?: "",
        ).joinToString(",") { csvEscape(it) }
      }
    val body = listOf(header, rows).filter { it.isNotEmpty() }.joinToString("\n")
    val dir = File(context.cacheDir, "soa-reports")
    if (!dir.exists() && !dir.mkdirs()) return null
    val name = "soa-report-day-${report.dayKey}-${commerceId.take(8)}.csv"
    val file = File(dir, name)
    return try {
      file.writeText(body, Charsets.UTF_8)
      file
    } catch (_: Exception) {
      null
    }
  }

  private fun csvEscape(value: String): String {
    val s = value.replace("\"", "\"\"")
    return "\"$s\""
  }
}
