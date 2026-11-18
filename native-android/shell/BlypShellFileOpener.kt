package com.haroldndougou.blyp.shell

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

object BlypShellFileOpener {
  private fun authority(context: Context): String =
    "${context.packageName}.blyp.shell.fileprovider"

  fun openLocalFile(context: Context, file: File, contentType: String?) {
    val ct =
      contentType?.trim()?.ifEmpty { null }
        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(
          file.extension.lowercase(),
        )
        ?: "application/octet-stream"
    val uri =
      FileProvider.getUriForFile(context.applicationContext, authority(context), file)
    openUri(context, uri, ct)
  }

  fun openHttpUrl(context: Context, url: String, contentType: String?) {
    val uri = Uri.parse(url.trim())
    val ct = contentType?.trim()?.ifEmpty { null } ?: "*/*"
    openUri(context, uri, ct)
  }

  private fun openUri(context: Context, uri: Uri, contentType: String) {
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, contentType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    try {
      context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      intent.setDataAndType(uri, "*/*")
      context.startActivity(intent)
    }
  }
}
