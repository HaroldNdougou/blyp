package com.haroldndougou.blyp.shell

import android.widget.ImageView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

object BlypShellChatImageLoader {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(15, TimeUnit.SECONDS)
      .build()

  private val mem =
    object : android.util.LruCache<String, android.graphics.Bitmap>(12 * 1024 * 1024) {
      override fun sizeOf(key: String, value: android.graphics.Bitmap): Int = value.byteCount
    }

  fun peek(key: String?): android.graphics.Bitmap? {
    val k = key?.trim().orEmpty()
    if (k.isEmpty() || k.equals("null", true)) return null
    return mem.get(k)
  }

  fun remember(key: String?, bitmap: android.graphics.Bitmap?) {
    val k = key?.trim().orEmpty()
    if (k.isEmpty() || k.equals("null", true) || bitmap == null) return
    mem.put(k, bitmap)
  }

  /** Photo déjà en mémoire, sinon fichier local, sinon lien réseau. */
  fun decodeBest(
    context: android.content.Context,
    conversationId: String,
    imageKey: String?,
    localPath: String?,
    preferFresh: Boolean = false,
  ): android.graphics.Bitmap? {
    val key = imageKey?.trim().orEmpty()
    val local = localPath?.trim().orEmpty()
    if (!preferFresh) {
      peek(key)?.let { return it }
      peek(local)?.let { return it }
    }
    if (local.isNotEmpty() && !local.equals("null", true) && File(local).isFile) {
      decodeFile(local, 1600)?.let { bmp ->
        remember(local, bmp)
        remember(key, bmp)
        return bmp
      }
    }
    if (key.isNotEmpty() && !key.equals("null", true)) {
      readDisk(context, key)?.let { bmp ->
        remember(key, bmp)
        return bmp
      }
    }
    if (key.isEmpty() || key.equals("null", true)) return null
    val url = presignPlayUrl(context, conversationId, key) ?: return null
    val bmp = decodeUrl(url, context, key) ?: return null
    remember(key, bmp)
    return bmp
  }

  fun loadFull(
    context: android.content.Context,
    conversationId: String,
    imageKey: String,
    onDone: (android.graphics.Bitmap?) -> Unit,
  ) {
    val key = imageKey.trim()
    if (key.isEmpty() || key.equals("null", ignoreCase = true)) {
      onDone(null)
      return
    }
    Thread {
        val app = context.applicationContext
        val hit = decodeBest(app, conversationId, key, null, preferFresh = true)
        val bmp =
          hit
            ?: run {
              val url = presignPlayUrl(app, conversationId, key)
              if (url.isNullOrBlank() || url.equals("null", true)) {
                null
              } else {
                decodeUrl(url, app, key)
              }
            }
        android.os.Handler(android.os.Looper.getMainLooper()).post { onDone(bmp) }
      }
      .start()
  }

  private fun decodeUrl(
    url: String,
    context: android.content.Context? = null,
    diskKey: String? = null,
  ): android.graphics.Bitmap? {
    return try {
      val req = okhttp3.Request.Builder().url(url).get().build()
      http.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) return null
        val bytes = resp.body?.bytes() ?: return null
        val k = diskKey?.trim().orEmpty()
        if (context != null && k.isNotEmpty()) writeDisk(context, k, bytes)
        decodeSampled(bytes)
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun diskFile(context: android.content.Context, key: String): File {
    val safe = key.trim().replace(Regex("[^a-zA-Z0-9_.-]"), "_").takeLast(40)
    val dir = File(context.cacheDir, "chat-img")
    dir.mkdirs()
    return File(dir, "${key.hashCode()}_$safe.jpg")
  }

  private fun readDisk(context: android.content.Context, key: String): android.graphics.Bitmap? {
    val f = diskFile(context, key)
    if (!f.isFile || f.length() < 24) return null
    return decodeFile(f.absolutePath, 1600)
  }

  private fun writeDisk(context: android.content.Context, key: String, bytes: ByteArray) {
    try {
      val f = diskFile(context, key)
      f.parentFile?.mkdirs()
      f.outputStream().use { it.write(bytes) }
    } catch (_: Exception) {
    }
  }

  private fun decodeSampled(bytes: ByteArray): android.graphics.Bitmap? {
    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val opts =
      android.graphics.BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, 1600)
      }
    return android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
  }

  private fun sampleSize(width: Int, height: Int, maxEdge: Int): Int {
    var sample = 1
    while (width / sample > maxEdge || height / sample > maxEdge) sample *= 2
    return sample.coerceAtLeast(1)
  }

  fun loadThumb(
    context: android.content.Context,
    conversationId: String,
    imageKey: String,
    thumbKey: String?,
    localPath: String?,
    into: ImageView,
    busy: android.view.View?,
    arrive: Boolean = false,
  ) {
    val token = listOf(localPath.orEmpty(), imageKey, thumbKey.orEmpty()).joinToString("|")
    into.tag = token
    val hit = peek(imageKey) ?: peek(thumbKey) ?: peek(localPath)
    if (hit != null) {
      showBitmap(into, hit, arrive)
      busy?.visibility = android.view.View.GONE
      return
    }
    into.setImageDrawable(null)
    into.alpha = 1f
    into.translationY = 0f
    busy?.visibility = android.view.View.VISIBLE
    val app = context.applicationContext
    Thread {
        val bmp = decodeBest(app, conversationId, thumbKey?.trim().orEmpty().ifEmpty { imageKey }, localPath)
        if (bmp != null && imageKey.isNotBlank()) remember(imageKey, bmp)
        into.post {
          if (into.tag != token) return@post
          if (bmp != null) showBitmap(into, bmp, arrive)
          busy?.visibility = android.view.View.GONE
        }
      }
      .start()
  }

  private fun showBitmap(into: ImageView, bmp: android.graphics.Bitmap, arrive: Boolean) {
    into.setImageBitmap(bmp)
    if (!arrive) {
      into.animate().cancel()
      into.alpha = 1f
      into.translationY = 0f
      return
    }
    val drop = 18f * into.resources.displayMetrics.density
    into.alpha = 0f
    into.translationY = drop
    into.animate().alpha(1f).translationY(0f).setDuration(220).start()
  }

  private fun decodeFile(path: String, maxEdge: Int): android.graphics.Bitmap? {
    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
    android.graphics.BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val opts =
      android.graphics.BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxEdge)
      }
    return android.graphics.BitmapFactory.decodeFile(path, opts)
  }

  private fun presignPlayUrl(
    context: android.content.Context,
    conversationId: String,
    key: String,
  ): String? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    val cid = conversationId.trim()
    val url =
      "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
        java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
        "/messages"
    val payload = JSONObject().put("type", "image-play").put("key", key)
    val req =
      Request.Builder()
        .url(url)
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .post(payload.toString().toRequestBody("application/json".toMediaType()))
        .build()
    return try {
      http.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) return null
        val body = resp.body?.string().orEmpty()
        if (body.isBlank()) return null
        val raw = JSONObject(body).optString("url").trim()
        if (raw.isEmpty() || raw.equals("null", true)) null else raw
      }
    } catch (_: Exception) {
      null
    }
  }
}