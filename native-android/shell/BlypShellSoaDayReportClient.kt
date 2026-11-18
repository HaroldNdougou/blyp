package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class ShellSoaDayReportTrip(
  val tripId: String,
  val totalFcfa: Int,
  val tripStartedAt: String,
  val endedAt: String?,
  val isActive: Boolean,
)

data class ShellSoaDayReport(
  val dayKey: String,
  val totalFcfa: Int,
  val tripCount: Int,
  val trips: List<ShellSoaDayReportTrip>,
)

object BlypShellSoaDayReportClient {
  private val io = Executors.newSingleThreadExecutor()

  fun fetchDayReportAsync(
    context: Context,
    commerceId: String,
    dayKey: String,
    onDone: (ShellSoaDayReport?) -> Unit,
  ) {
    io.execute {
      onDone(fetchDayReportSync(context.applicationContext, commerceId, dayKey))
    }
  }

  fun fetchAggregatedReportAsync(
    context: Context,
    commerceId: String,
    periodKey: String,
    dayKeys: List<String>,
    onDone: (ShellSoaDayReport?) -> Unit,
  ) {
    io.execute {
      val reports = ArrayList<ShellSoaDayReport>()
      for (dk in dayKeys) {
        fetchDayReportSync(context.applicationContext, commerceId, dk)?.let { reports.add(it) }
      }
      onDone(aggregateReports(periodKey, reports))
    }
  }

  fun aggregateReports(periodKey: String, reports: List<ShellSoaDayReport>): ShellSoaDayReport? {
    if (reports.isEmpty()) return null
    val byTrip = LinkedHashMap<String, ShellSoaDayReportTrip>()
    var total = 0
    for (r in reports) {
      total += r.totalFcfa
      for (t in r.trips) {
        byTrip[t.tripId] = t
      }
    }
    val trips = byTrip.values.toList()
    return ShellSoaDayReport(
      dayKey = periodKey,
      totalFcfa = total,
      tripCount = trips.size,
      trips = trips,
    )
  }

  private fun fetchDayReportSync(
    context: Context,
    commerceId: String,
    dayKey: String,
  ): ShellSoaDayReport? {
    val runtime = BlypShellRuntime.readFresh(context) ?: return null
    val id = commerceId.trim()
    val day = dayKey.trim()
    if (id.isEmpty() || day.isEmpty()) return null
    val urlStr =
      "${runtime.apiBaseUrl}/commerces/${id}/soa-trip/day-report?day=${java.net.URLEncoder.encode(day, "UTF-8")}"
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          connectTimeout = 25_000
          readTimeout = 35_000
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
          setRequestProperty("Accept", "application/json")
        }
      val code = conn.responseCode
      val text =
        (if (code in 200..299) conn.inputStream else conn.errorStream)
          ?.bufferedReader()
          ?.use(BufferedReader::readText)
          .orEmpty()
      conn.disconnect()
      if (code !in 200..299) return null
      parseReport(JSONObject(text.ifBlank { "{}" }), day)
    } catch (_: Exception) {
      null
    }
  }

  private fun parseReport(obj: JSONObject, dayKey: String): ShellSoaDayReport? {
    val report = obj.optJSONObject("report") ?: obj
    val day = report.optString("dayKey", dayKey).trim().ifEmpty { dayKey }
    val total = report.optInt("totalFcfa", 0).coerceAtLeast(0)
    val count = report.optInt("tripCount", 0).coerceAtLeast(0)
    val arr = report.optJSONArray("trips") ?: JSONArray()
    val trips = ArrayList<ShellSoaDayReportTrip>()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val tripId = o.optString("tripId", "").trim().ifEmpty { "trip-$i" }
      trips.add(
        ShellSoaDayReportTrip(
          tripId = tripId,
          totalFcfa = o.optInt("totalFcfa", 0).coerceAtLeast(0),
          tripStartedAt = o.optString("tripStartedAt", "").trim(),
          endedAt = o.optString("endedAt", "").trim().ifEmpty { null },
          isActive = o.optBoolean("isActive", false),
        ),
      )
    }
    return ShellSoaDayReport(
      dayKey = day,
      totalFcfa = total,
      tripCount = if (count > 0) count else trips.size,
      trips = trips,
    )
  }
}
