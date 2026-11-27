package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

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

  /**
   * Numéros présents sur Blyp. Les paquets partent en parallèle.
   * `onPartial` reçoit chaque paquet trouvé, sans attendre la fin.
   * `null` seulement si aucun paquet n’a répondu.
   */
  fun phonesOnBlyp(
    context: Context,
    phonesNine: List<String>,
    onPartial: ((Set<String>) -> Unit)? = null,
  ): Set<String>? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val normalized =
      phonesNine
        .map { it.replace(Regex("\\D"), "").takeLast(9) }
        .filter { it.length == 9 && it[0] == '6' }
        .distinct()
    if (normalized.isEmpty()) return emptySet()
    val chunks = normalized.chunked(40)
    val out = HashSet<String>()
    val anyOk = AtomicBoolean(false)
    val pool = Executors.newFixedThreadPool(minOf(4, chunks.size))
    val latch = CountDownLatch(chunks.size)
    for (chunk in chunks) {
      pool.execute {
        try {
          val found = lookupChunk(runtime, chunk)
          if (found != null) {
            anyOk.set(true)
            if (found.isNotEmpty()) {
              synchronized(out) { out.addAll(found) }
              onPartial?.invoke(found)
            }
          }
        } finally {
          latch.countDown()
        }
      }
    }
    latch.await(20, TimeUnit.SECONDS)
    pool.shutdownNow()
    return if (anyOk.get()) synchronized(out) { HashSet(out) } else null
  }

  private fun lookupChunk(
    runtime: BlypShellRuntime.Snapshot,
    chunk: List<String>,
  ): Set<String>? {
    val body = JSONObject().apply { put("phones", JSONArray(chunk)) }
    val (ok, json) =
      postJson(
        runtime,
        "${runtime.apiBaseUrl}/contacts/blyp-lookup",
        body,
        connectMs = 8_000,
        readMs = 12_000,
      ) ?: return null
    if (!ok || json == null) return null
    val items = json.optJSONArray("items") ?: return emptySet()
    val found = HashSet<String>()
    for (i in 0 until items.length()) {
      val o = items.optJSONObject(i) ?: continue
      if (!o.optBoolean("onBlyp", false)) continue
      val nine = o.optString("phone", "").replace(Regex("\\D"), "").takeLast(9)
      if (nine.length == 9 && nine[0] == '6') found.add(nine)
    }
    return found
  }

  private fun postJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    body: JSONObject,
    connectMs: Int = 25_000,
    readMs: Int = 35_000,
  ): Pair<Boolean, JSONObject?>? {
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = connectMs
          readTimeout = readMs
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
