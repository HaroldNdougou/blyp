package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class ShellSoaTripSeat(
  val seatNumber: Int,
  val amountFcfa: Int,
  val paidAt: String,
  val transactionId: String,
  val payerName: String?,
)

data class ShellSoaCarTrip(
  val commerceId: String,
  val totalFcfa: Int,
  val tripStartedAt: String,
  val seats: List<ShellSoaTripSeat>,
)

data class ShellSoaSeatAggregate(
  val seatNumber: Int,
  val totalFcfa: Int,
  val paymentCount: Int,
)

object BlypShellSoaSeatAgg {
  fun buildMap(seats: List<ShellSoaTripSeat>): Map<Int, ShellSoaSeatAggregate> {
    val bySeat = HashMap<Int, MutableList<ShellSoaTripSeat>>()
    for (s in seats) {
      bySeat.getOrPut(s.seatNumber) { ArrayList() }.add(s)
    }
    val out = HashMap<Int, ShellSoaSeatAggregate>()
    for ((num, list) in bySeat) {
      val sorted = list.sortedByDescending { it.paidAt }
      out[num] =
        ShellSoaSeatAggregate(
          seatNumber = num,
          totalFcfa = sorted.sumOf { it.amountFcfa },
          paymentCount = sorted.size,
        )
    }
    return out
  }
}

object BlypShellSoaTripClient {
  private val io = Executors.newSingleThreadExecutor()

  fun fetchTripAsync(context: Context, commerceId: String, onDone: (ShellSoaCarTrip?) -> Unit) {
    io.execute {
      onDone(fetchTripSync(context.applicationContext, commerceId))
    }
  }

  fun resetTripAsync(
    context: Context,
    commerceId: String,
    onDone: (ShellSoaCarTrip?) -> Unit,
  ) {
    io.execute {
      onDone(resetTripSync(context.applicationContext, commerceId))
    }
  }

  private fun fetchTripSync(context: Context, commerceId: String): ShellSoaCarTrip? {
    val runtime = BlypShellRuntime.readFresh(context) ?: return null
    val id = commerceId.trim()
    if (id.isEmpty()) return null
    val (ok, json) =
      getJson(runtime, "${runtime.apiBaseUrl}/commerces/${id.trim()}/soa-trip")
        ?: return null
    if (!ok || json == null) return null
    return parseTrip(json.optJSONObject("trip") ?: json)
  }

  private fun resetTripSync(context: Context, commerceId: String): ShellSoaCarTrip? {
    val runtime = BlypShellRuntime.readFresh(context) ?: return null
    val id = commerceId.trim()
    if (id.isEmpty()) return null
    val (ok, json) =
      postEmpty(runtime, "${runtime.apiBaseUrl}/commerces/${id.trim()}/soa-trip")
        ?: return null
    if (!ok || json == null) return null
    return parseTrip(json.optJSONObject("trip") ?: json)
  }

  private fun parseTrip(obj: JSONObject?): ShellSoaCarTrip? {
    if (obj == null) return null
    val commerceId = obj.optString("commerceId", "").trim()
    val total = obj.optInt("totalFcfa", 0).coerceAtLeast(0)
    val started = obj.optString("tripStartedAt", "").trim()
    val arr = obj.optJSONArray("seats") ?: JSONArray()
    val seats = ArrayList<ShellSoaTripSeat>()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val n = o.optInt("seatNumber", 0)
      if (n !in 1..18) continue
      seats.add(
        ShellSoaTripSeat(
          seatNumber = n,
          amountFcfa = o.optInt("amountFcfa", 0).coerceAtLeast(0),
          paidAt = o.optString("paidAt", "").trim(),
          transactionId = o.optString("transactionId", "").trim(),
          payerName = o.optString("payerName", "").trim().ifEmpty { null },
        ),
      )
    }
    return ShellSoaCarTrip(
      commerceId = commerceId,
      totalFcfa = total,
      tripStartedAt = started,
      seats = seats,
    )
  }

  private fun getJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
  ): Pair<Boolean, JSONObject?>? {
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
      val json =
        try {
          JSONObject(text.ifBlank { "{}" })
        } catch (_: Exception) {
          null
        }
      (code in 200..299) to json
    } catch (_: Exception) {
      null
    }
  }

  private fun postEmpty(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
  ): Pair<Boolean, JSONObject?>? {
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = 25_000
          readTimeout = 35_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        }
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write("{}")
      }
      val code = conn.responseCode
      val text =
        (if (code in 200..299) conn.inputStream else conn.errorStream)
          ?.bufferedReader()
          ?.use(BufferedReader::readText)
          .orEmpty()
      conn.disconnect()
      val json =
        try {
          JSONObject(text.ifBlank { "{}" })
        } catch (_: Exception) {
          null
        }
      (code in 200..299) to json
    } catch (_: Exception) {
      null
    }
  }
}
