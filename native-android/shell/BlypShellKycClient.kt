package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object BlypShellKycClient {
  fun uploadSide(
    context: Context,
    side: String,
    file: File,
    contentType: String,
  ): String? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val ct = contentType.ifBlank { "image/jpeg" }
    return try {
      val presignBody =
        JSONObject().apply {
          put("docType", "national_id")
          put("side", side)
          put("contentType", ct)
        }
      val presign =
        apiJson(runtime, "${runtime.apiBaseUrl}/kyc/presign", "POST", presignBody)
          ?: return null
      val uploadUrl = presign.optString("uploadUrl", "").trim()
      val key = presign.optString("key", "").trim()
      if (key.isEmpty()) return null
      if (uploadUrl.startsWith("mock://")) return key
      if (uploadUrl.isNotEmpty() && !BlypShellUpload.putFile(uploadUrl, file, ct)) return null
      key
    } catch (_: Exception) {
      null
    }
  }

  fun submit(
    context: Context,
    frontKey: String,
    backKey: String,
    selfieKey: String,
  ): Boolean {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return false
    return try {
      val body =
        JSONObject().apply {
          put("docType", "national_id")
          put("frontKey", frontKey)
          put("backKey", backKey)
          put("selfieKey", selfieKey)
        }
      val res =
        apiJson(runtime, "${runtime.apiBaseUrl}/kyc/submit", "POST", body) ?: return false
      res.optJSONObject("user")?.let { BlypShellUserParse.apply(context, it) }
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun apiJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    method: String,
    body: JSONObject,
  ): JSONObject? {
    val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 30_000
      readTimeout = 45_000
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
    if (code !in 200..299) return null
    return JSONObject(text.ifBlank { "{}" })
  }
}
