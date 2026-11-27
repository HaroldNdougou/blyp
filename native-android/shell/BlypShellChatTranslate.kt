package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Traduction des messages reçus, comme avant. Pas de traduction si la langue est déjà celle du téléphone. */
object BlypShellChatTranslate {
  private val main = Handler(Looper.getMainLooper())
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(12, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()
  private val ram = HashMap<String, String>()
  private val busy = HashSet<String>()

  fun peek(key: String): String? = ram[key]

  fun ensure(
    context: Context,
    conversationId: String,
    rows: List<ShellChatBubble>,
    onReady: () -> Unit,
  ) {
    val phoneLang = Locale.getDefault().language.lowercase().substringBefore('-')
    val peer = BlypShellChatTyping.peerLanguage(conversationId)
    if (peer.isNullOrEmpty() || peer == phoneLang) return
    val pending = ArrayList<ShellChatBubble>()
    for (row in rows) {
      val text = translatable(row) ?: continue
      val key = storageKey(row)
      if (ram.containsKey(key) || !busy.add(key)) continue
      pending.add(row)
      if (pending.size >= 16) break
    }
    if (pending.isEmpty()) return
    val app = context.applicationContext
    Thread {
        val found = HashMap<String, String>()
        try {
          val runtime = BlypShellRuntime.readFresh(app) ?: return@Thread
          val items = JSONArray()
          for (row in pending) {
            items.put(JSONObject().put("id", row.id).put("text", translatable(row)))
          }
          val body =
            JSONObject()
              .put("targetLanguage", phoneLang.ifEmpty { "en" })
              .put("items", items)
          val url =
            runtime.apiBaseUrl.trimEnd('/') +
              "/conversations/" +
              java.net.URLEncoder.encode(conversationId, Charsets.UTF_8.name()) +
              "/translate"
          val req =
            Request.Builder()
              .url(url)
              .header("Authorization", "Bearer ${runtime.accessToken}")
              .header("Accept", "application/json")
              .post(body.toString().toRequestBody("application/json".toMediaType()))
              .build()
          http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@use
            val root = JSONObject(resp.body?.string().orEmpty())
            val arr = root.optJSONArray("items") ?: return@use
            for (i in 0 until arr.length()) {
              val item = arr.optJSONObject(i) ?: continue
              if (item.optBoolean("skipped") || item.optBoolean("error")) continue
              val id = item.optString("id").trim()
              val translated = item.optString("translatedText").trim()
              val source = item.optString("sourceLanguage").lowercase().substringBefore('-')
              val row = pending.find { it.id == id } ?: continue
              val original = translatable(row).orEmpty()
              if (translated.isEmpty() || translated == original) continue
              if (source.isNotEmpty() && source == phoneLang) continue
              found[storageKey(row)] = translated
            }
          }
        } catch (_: Exception) {
        } finally {
          for (row in pending) busy.remove(storageKey(row))
        }
        if (found.isEmpty()) return@Thread
        main.post {
          ram.putAll(found)
          onReady()
        }
      }
      .start()
  }

  private fun storageKey(row: ShellChatBubble): String =
    if (row.type == "money") row.id + "::caption" else row.id

  private fun translatable(row: ShellChatBubble): String? {
    if (row.mine || row.deletedForAll) return null
    val text = row.body.trim()
    if (text.isEmpty()) return null
    if (row.type == "text") return text
    if (row.type == "money" && !looksLikeAmount(text, row.moneyAmountFcfa)) return text
    if (row.type == "image" || row.type == "document") return text
    return null
  }

  private fun looksLikeAmount(caption: String, amount: Int): Boolean {
    if (caption.matches(Regex("(?i)^[\\d\\s.]+\\s*(fcfa|cfa|f)\\s*$"))) return true
    val digits = caption.filter { it.isDigit() }
    return amount > 0 && digits == amount.toString()
  }
}
