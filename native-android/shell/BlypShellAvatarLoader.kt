package com.haroldndougou.blyp.shell

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.collection.LruCache
import com.haroldndougou.blyp.R
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

object BlypShellAvatarLoader {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(12, TimeUnit.SECONDS)
      .build()
  private val cache = LruCache<String, Bitmap>(24)

  /** Hors du fil principal. Réutilise le cache déjà vu sur Payer. */
  fun fetchBitmap(url: String, diskContext: android.content.Context? = null): Bitmap? {
    val u = url.trim()
    if (u.isEmpty()) return null
    cache.get(u)?.let { return it }
    val ctx = diskContext?.applicationContext
    if (ctx != null) {
      readDisk(ctx, u)?.let { bmp ->
        cache.put(u, bmp)
        return bmp
      }
    }
    return try {
      val req = Request.Builder().url(u).get().build()
      http.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) return null
        val bytes = resp.body?.bytes() ?: return null
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        cache.put(u, bmp)
        if (ctx != null) writeDisk(ctx, u, bytes)
        bmp
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun diskFile(context: android.content.Context, url: String): File {
    val dir = File(context.cacheDir, "avatar-disk")
    dir.mkdirs()
    return File(dir, "${url.hashCode()}.jpg")
  }

  private fun readDisk(context: android.content.Context, url: String): Bitmap? {
    val f = diskFile(context, url)
    if (!f.isFile || f.length() < 24) return null
    return BitmapFactory.decodeFile(f.absolutePath)
  }

  private fun writeDisk(context: android.content.Context, url: String, bytes: ByteArray) {
    try {
      val f = diskFile(context, url)
      f.parentFile?.mkdirs()
      f.outputStream().use { it.write(bytes) }
    } catch (_: Exception) {
    }
  }

  fun loadInto(
    url: String?,
    imageView: ImageView,
    initialView: TextView,
    initial: String,
    placeholder: Int = 0,
  ) {
    fun showMissing() {
      if (placeholder != 0) {
        imageView.setImageResource(placeholder)
        imageView.visibility = View.VISIBLE
        initialView.visibility = View.GONE
      } else {
        imageView.visibility = View.GONE
        initialView.visibility = View.VISIBLE
        initialView.text = initial
      }
    }
    val u = url?.trim().orEmpty()
    if (u.isBlank()) {
      imageView.setTag(R.id.blyp_avatar_load_url, null)
      showMissing()
      return
    }
    val prevUrl = imageView.getTag(R.id.blyp_avatar_load_url) as? String
    if (prevUrl == u && imageView.visibility == View.VISIBLE) {
      initialView.visibility = View.GONE
      return
    }
    cache.get(u)?.let { bmp ->
      imageView.setTag(R.id.blyp_avatar_load_url, u)
      imageView.setImageBitmap(bmp)
      imageView.visibility = View.VISIBLE
      initialView.visibility = View.GONE
      return
    }
    if (prevUrl == u) return
    val gen = (imageView.getTag(R.id.blyp_avatar_load_gen) as? Int ?: 0) + 1
    imageView.setTag(R.id.blyp_avatar_load_gen, gen)
    imageView.setTag(R.id.blyp_avatar_load_url, u)
    // URL connue : ne pas laisser l’initiale (P…) par-dessus pendant le fetch
    if (imageView.visibility == View.VISIBLE) {
      initialView.visibility = View.GONE
    }
    Thread {
        val bmp = fetchBitmap(u, imageView.context)
        imageView.post {
          if (imageView.getTag(R.id.blyp_avatar_load_gen) != gen) return@post
          if (bmp != null) {
            imageView.setImageBitmap(bmp)
            imageView.visibility = View.VISIBLE
            initialView.text = ""
            initialView.visibility = View.GONE
          } else {
            if (placeholder == 0 && imageView.visibility == View.VISIBLE) return@post
            showMissing()
          }
        }
      }
      .start()
  }
}
