package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import java.io.File

/** Galerie / caméra — sélecteurs standards + applis galerie courantes en secours. */
object BlypShellPhotoPick {
  /** Extrait l’URI renvoyé par la galerie (clipData, stream, chemins OEM). */
  fun onePhotoFromResult(data: Intent?): Uri? {
    if (data == null) return null
    data.data?.let { return it }
    data.clipData?.let { clip ->
      if (clip.itemCount > 0) return clip.getItemAt(0).uri
    }
    data.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let { return it }
    @Suppress("DEPRECATION")
    (data.extras?.get("android.intent.extra.quickCapture") as? Uri)?.let { return it }
    for (key in listOf("file_path", "picture-path", "path", "uri", "image_path")) {
      val raw = data.getStringExtra(key)?.trim().orEmpty()
      if (raw.isEmpty()) continue
      if (raw.startsWith("content://") || raw.startsWith("file://")) {
        return Uri.parse(raw)
      }
      val f = File(raw)
      if (f.isFile) return Uri.fromFile(f)
    }
    return null
  }

  fun copyToCache(context: Context, uri: Uri): File? {
    return try {
      val out = File(context.cacheDir, "chat-pick-${java.util.UUID.randomUUID()}.jpg")
      when (uri.scheme?.lowercase()) {
        "file" -> {
          val path = uri.path ?: return null
          val src = File(path)
          if (!src.isFile) return null
          src.inputStream().use { input ->
            out.outputStream().use { output -> input.copyTo(output) }
          }
        }
        "content" -> {
          val cr = context.contentResolver
          try {
            cr.takePersistableUriPermission(
              uri,
              Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
          } catch (_: Exception) {
            /* URI ponctuelle sans permission persistante */
          }
          val stream =
            cr.openInputStream(uri)
              ?: cr.openAssetFileDescriptor(uri, "r")?.createInputStream()
              ?: return null
          stream.use { input ->
            out.outputStream().use { output -> input.copyTo(output) }
          }
        }
        else -> return null
      }
      out.takeIf { it.length() > 0 }
    } catch (_: Exception) {
      null
    }
  }

  /** Intents à essayer dans l’ordre (le premier qui accepte `launch` gagne). */
  fun galleryPickIntents(): List<Intent> {
    val pick =
      Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
        type = "image/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
      }
    val getContent =
      Intent(Intent.ACTION_GET_CONTENT).apply {
        type = "image/*"
        addCategory(Intent.CATEGORY_OPENABLE)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
      }
    val fallbacks =
      listOf(
        Intent(pick).apply { setPackage("com.sec.android.gallery3d") },
        Intent(getContent).apply { setPackage("com.google.android.apps.photos") },
        Intent(pick).apply { setPackage("com.google.android.apps.photos") },
      )
    val generic =
      listOf(
        getContent,
        pick,
        Intent.createChooser(getContent, null),
      )
    return generic + fallbacks
  }
}