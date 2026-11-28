package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Nom affiché d’un pair BLE — RAM, puis disque, puis réseau (calque `resolvePeerDisplayName`). */
object BlypShellPeerNames {
  private const val PREFS = "blyp_shell_peer_names_v1"
  private val ram = ConcurrentHashMap<String, String>()
  private val inflight = ConcurrentHashMap.newKeySet<String>()
  private val waiters = ConcurrentHashMap<String, MutableList<(String) -> Unit>>()
  private val gate = Any()
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  fun cached(context: Context, accountId: String): String? {
    val id = accountId.trim().uppercase()
    ram[id]?.let { return it }
    val disk =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(id, null)
        ?.trim()
        ?.ifEmpty { null }
        ?: return null
    ram[id] = disk
    return disk
  }

  /** Réseau seulement si rien en cache ; [onName] sur le fil principal. */
  fun resolveAsync(context: Context, accountId: String, onName: (String) -> Unit) {
    val id = accountId.trim().uppercase()
    if (!id.startsWith("BLYP-")) return
    val app = context.applicationContext
    cached(app, id)?.let {
      main.post { onName(it) }
      return
    }
    val shouldFetch =
      synchronized(gate) {
        waiters.getOrPut(id) { mutableListOf() }.add(onName)
        inflight.add(id)
      }
    if (!shouldFetch) return
    io.execute {
      val name =
        try {
          fetch(app, id)
        } catch (_: Exception) {
          null
        }
      val pending =
        synchronized(gate) {
          val queued = waiters.remove(id)?.toList().orEmpty()
          inflight.remove(id)
          queued
        }
      if (name.isNullOrBlank()) return@execute
      ram[id] = name
      app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(id, name).apply()
      main.post {
        for (waiter in pending) waiter(name)
      }
    }
  }

  private fun fetch(context: Context, id: String): String? {
    val runtime = BlypShellRuntime.readFresh(context) ?: return null
    return try {
      val url = "${runtime.apiBaseUrl}/accounts/${URLEncoder.encode(id, "UTF-8")}/public"
      val conn =
        (URL(url).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          connectTimeout = 15_000
          readTimeout = 20_000
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        }
      val code = conn.responseCode
      val text =
        if (code in 200..299) conn.inputStream.bufferedReader().use(BufferedReader::readText) else ""
      conn.disconnect()
      if (text.isBlank()) return null
      val name =
        JSONObject(text).optString("displayName", "").trim().replace(Regex("\\s+"), " ").take(48)
      if (name.length < 2) null else name
    } catch (_: Exception) {
      null
    }
  }
}
