package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

object BlypShellShare {
  private fun authority(context: Context): String =
    "${context.packageName}.blyp.shell.fileprovider"

  fun shareTextAndOptionalFile(
    context: Context,
    title: String,
    message: String,
    file: File?,
    mimeType: String,
  ) {
    val intent =
      if (file != null && file.isFile) {
        val uri =
          FileProvider.getUriForFile(context.applicationContext, authority(context), file)
        Intent(Intent.ACTION_SEND).apply {
          type = mimeType
          putExtra(Intent.EXTRA_SUBJECT, title)
          putExtra(Intent.EXTRA_TEXT, message)
          putExtra(Intent.EXTRA_STREAM, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      } else {
        Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_SUBJECT, title)
          putExtra(Intent.EXTRA_TEXT, message)
        }
      }
    context.startActivity(
      Intent.createChooser(intent, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }
}
