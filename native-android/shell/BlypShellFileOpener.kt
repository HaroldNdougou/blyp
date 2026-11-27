package com.haroldndougou.blyp.shell

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

object BlypShellFileOpener {
  private fun authority(context: Context): String =
    "${context.packageName}.blyp.shell.fileprovider"

  fun openLocalFile(context: Context, file: File, contentType: String?): Boolean {
    return try {
      val ct =
        contentType?.trim()?.ifEmpty { null }
          ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(
            file.extension.lowercase(),
          )
          ?: "application/octet-stream"
      val uri =
        FileProvider.getUriForFile(context.applicationContext, authority(context), file)
      openUri(context, uri, ct)
    } catch (_: Exception) {
      false
    }
  }

  fun openHttpUrl(context: Context, url: String, contentType: String?) {
    val uri = Uri.parse(url.trim())
    val ct = contentType?.trim()?.ifEmpty { null } ?: "*/*"
    openUri(context, uri, ct)
  }

  private fun openUri(context: Context, uri: Uri, contentType: String): Boolean {
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, contentType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        clipData = ClipData.newRawUri("doc", uri)
      }
    if (uri.scheme == "content") {
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
      val targets =
        context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      for (ri in targets) {
        context.grantUriPermission(ri.activityInfo.packageName, uri, flags)
      }
    }
    return try {
      context.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: ActivityNotFoundException) {
      try {
        intent.setDataAndType(uri, "*/*")
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    } catch (_: Exception) {
      false
    }
  }
}
