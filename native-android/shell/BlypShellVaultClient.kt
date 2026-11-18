package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class ShellVaultDocumentRow(
  val id: String,
  val name: String,
  val sizeBytes: Long,
  val contentType: String,
  val createdAt: String,
)

object BlypShellVaultClient {
  private val io = Executors.newSingleThreadExecutor()

  data class VaultList(
    val items: List<ShellVaultDocumentRow>,
    val usedBytes: Long,
    val maxBytes: Long,
  )

  fun listAsync(context: Context, onDone: (VaultList?) -> Unit) {
    io.execute { onDone(listSync(context)) }
  }

  fun listSync(context: Context): VaultList? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    return try {
      val url = URL("${runtime.apiBaseUrl}/vault/documents")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 20_000
        readTimeout = 25_000
        setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
      }
      val code = conn.responseCode
      val text =
        conn.inputStream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
      conn.disconnect()
      if (code !in 200..299) return null
      parseList(JSONObject(text.ifBlank { "{}" }))
    } catch (_: Exception) {
      null
    }
  }

  fun downloadUrlSync(context: Context, docId: String): Pair<String, String>? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val id = docId.trim()
    if (id.isEmpty()) return null
    return try {
      val url = URL("${runtime.apiBaseUrl}/vault/documents/$id")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 20_000
        readTimeout = 25_000
        setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
      }
      val code = conn.responseCode
      val text =
        conn.inputStream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
      conn.disconnect()
      if (code !in 200..299) return null
      val json = JSONObject(text.ifBlank { "{}" })
      val downloadUrl = json.optString("downloadUrl", "").trim()
      val contentType = json.optString("contentType", "application/octet-stream").trim()
      if (downloadUrl.isEmpty()) return null
      downloadUrl to contentType
    } catch (_: Exception) {
      null
    }
  }

  private fun parseList(json: JSONObject): VaultList {
    val itemsArr = json.optJSONArray("items") ?: JSONArray()
    val items = ArrayList<ShellVaultDocumentRow>()
    for (i in 0 until itemsArr.length()) {
      val o = itemsArr.optJSONObject(i) ?: continue
      items.add(
        ShellVaultDocumentRow(
          id = o.optString("id", ""),
          name = o.optString("name", "—"),
          sizeBytes = o.optLong("sizeBytes", 0),
          contentType = o.optString("contentType", ""),
          createdAt = o.optString("createdAt", ""),
        ),
      )
    }
    return VaultList(
      items = items.filter { it.id.isNotBlank() },
      usedBytes = json.optLong("usedBytes", 0),
      maxBytes = json.optLong("maxBytes", 200L * 1024 * 1024),
    )
  }
}
