package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object BlypShellContactsClient {
  fun lookupPhones(context: Context, phonesNine: List<String>): Map<String, String>? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val normalized =
      phonesNine
        .map { it.replace(Regex("\\D"), "").takeLast(9) }
        .filter { it.length == 9 && it[0] == '6' }
        .distinct()
    if (normalized.isEmpty()) return emptyMap()
    val body = JSONObject().apply { put("phones", JSONArray(normalized)) }
    val (ok, json) =
      postJson(runtime, "${runtime.apiBaseUrl}/contacts/blyp-lookup", body) ?: return null
    if (!ok || json == null) return null
    val items = json.optJSONArray("items") ?: return emptyMap()
    val out = HashMap<String, String>()
    for (i in 0 until items.length()) {
      val o = items.optJSONObject(i) ?: continue
      if (!o.optBoolean("onBlyp", false)) continue
      val nine = o.optString("phone", "").replace(Regex("\\D"), "").takeLast(9)
      val id = o.optString("accountId", "").trim().uppercase()
      if (nine.length == 9 && id.startsWith("BLYP-")) out[nine] = id
    }
    return out
  }

  private fun postJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    body: JSONObject,
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
        w.write(body.toString())
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
