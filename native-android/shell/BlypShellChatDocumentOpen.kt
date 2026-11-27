package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

object BlypShellChatDocumentOpen {
  fun openAsync(
    context: Context,
    conversationId: String,
    key: String,
    fileName: String,
    contentType: String?,
    onFinished: (ok: Boolean) -> Unit,
  ) {
    if (key.isBlank()) {
      onFinished(false)
      return
    }
    Thread {
        val ok = openBlocking(context.applicationContext, conversationId, key, fileName, contentType)
        Handler(Looper.getMainLooper()).post { onFinished(ok) }
      }
      .start()
  }

  private fun openBlocking(
    context: Context,
    conversationId: String,
    key: String,
    fileName: String,
    contentType: String?,
  ): Boolean {
    val dir = File(context.cacheDir, "blyp-doc")
    dir.mkdirs()
    val safeName = fileName.trim().ifEmpty { "document" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    val dest = File(dir, "${keyHash(key)}_$safeName")
    if (!dest.isFile || dest.length() < 16) {
      val presign =
        BlypShellChatPresign.post(
          context,
          conversationId,
          JSONObject().put("type", "document-download").put("key", key),
        ) ?: return false
      val url = presign.optString("url").trim()
      if (url.isEmpty() || url.equals("null", true)) return false
      if (!BlypShellChatPresign.downloadUrl(url, dest)) return false
    }
    return BlypShellFileOpener.openLocalFile(context, dest, contentType)
  }

  fun ensureLocalAsync(
    context: Context,
    conversationId: String,
    key: String,
    fileName: String,
    onFinished: (File?) -> Unit,
  ) {
    if (key.isBlank()) {
      onFinished(null)
      return
    }
    Thread {
        val file = localFile(context.applicationContext, conversationId, key, fileName)
        Handler(Looper.getMainLooper()).post { onFinished(file) }
      }
      .start()
  }

  private fun localFile(
    context: Context,
    conversationId: String,
    key: String,
    fileName: String,
  ): File? {
    val dir = File(context.cacheDir, "blyp-doc")
    dir.mkdirs()
    val safeName = fileName.trim().ifEmpty { "document" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    val dest = File(dir, "${keyHash(key)}_$safeName")
    if (dest.isFile && dest.length() >= 16) return dest
    val presign =
      BlypShellChatPresign.post(
        context,
        conversationId,
        JSONObject().put("type", "document-download").put("key", key),
      ) ?: return null
    val url = presign.optString("url").trim()
    if (url.isEmpty() || url.equals("null", true)) return null
    return if (BlypShellChatPresign.downloadUrl(url, dest)) dest else null
  }

  private fun keyHash(key: String): String {
    val d = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
    return d.joinToString("") { "%02x".format(it) }.take(20)
  }
}