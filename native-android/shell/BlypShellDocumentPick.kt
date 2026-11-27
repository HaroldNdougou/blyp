package com.haroldndougou.blyp.shell

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream

object BlypShellDocumentPick {
  data class Picked(
    val file: File,
    val displayName: String,
    val sizeBytes: Long,
    val contentType: String,
  )

  fun copyToCache(context: Context, uri: Uri): Picked? {
    val app = context.applicationContext
    val resolver = app.contentResolver
    var name = "document"
    var size = 0L
    resolver.query(uri, null, null, null, null)?.use { c ->
      if (c.moveToFirst()) {
        val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (ni >= 0) name = c.getString(ni)?.trim().orEmpty().ifEmpty { name }
        val si = c.getColumnIndex(OpenableColumns.SIZE)
        if (si >= 0) size = c.getLong(si).coerceAtLeast(0)
      }
    }
    val mime = resolver.getType(uri)?.trim().orEmpty().ifEmpty { "application/octet-stream" }
    val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    val dest = File(app.cacheDir, "chat-doc-${System.currentTimeMillis()}_$safe")
    return try {
      resolver.openInputStream(uri)?.use { input ->
        FileOutputStream(dest).use { output -> input.copyTo(output) }
      } ?: return null
      val len = if (size > 0) size else dest.length()
      Picked(dest, name, len, mime)
    } catch (_: Exception) {
      null
    }
  }
}