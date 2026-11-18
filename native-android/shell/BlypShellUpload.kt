package com.haroldndougou.blyp.shell

import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL

object BlypShellUpload {
  fun putFile(uploadUrl: String, file: File, contentType: String): Boolean {
    if (uploadUrl.startsWith("mock://")) return true
    return try {
      val conn = (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "PUT"
        doOutput = true
        connectTimeout = 45_000
        readTimeout = 90_000
        setRequestProperty("Content-Type", contentType)
      }
      FileInputStream(file).use { input ->
        conn.outputStream.use { out -> input.copyTo(out) }
      }
      val ok = conn.responseCode in 200..299
      conn.disconnect()
      ok
    } catch (_: Exception) {
      false
    }
  }
}
