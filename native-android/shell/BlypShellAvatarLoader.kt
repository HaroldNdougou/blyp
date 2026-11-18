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
import java.util.concurrent.TimeUnit

object BlypShellAvatarLoader {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(12, TimeUnit.SECONDS)
      .build()
  private val cache = LruCache<String, Bitmap>(24)

  /** Hors du fil principal. Réutilise le cache déjà vu sur Payer. */
  fun fetchBitmap(url: String): Bitmap? {
    val u = url.trim()
    if (u.isEmpty()) return null
    cache.get(u)?.let { return it }
    return try {
      val req = Request.Builder().url(u).get().build()
      http.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) return null
        val bytes = resp.body?.bytes() ?: return null
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        cache.put(u, bmp)
        bmp
      }
    } catch (_: Exception) {
      null
    }
  }

  fun loadInto(
    url: String?,
    imageView: ImageView,
    initialView: TextView,
    initial: String,
  ) {
    val u = url?.trim().orEmpty()
    if (u.isBlank()) {
      imageView.setTag(R.id.blyp_avatar_load_url, null)
      imageView.visibility = View.GONE
      initialView.visibility = View.VISIBLE
      initialView.text = initial
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
    Thread {
        try {
          val req = Request.Builder().url(u).get().build()
          http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@Thread
            val bytes = resp.body?.bytes() ?: return@Thread
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread
            cache.put(u, bmp)
            imageView.post {
              if (imageView.getTag(R.id.blyp_avatar_load_gen) != gen) return@post
              imageView.setImageBitmap(bmp)
              imageView.visibility = View.VISIBLE
              initialView.visibility = View.GONE
            }
          }
        } catch (_: Exception) {
          imageView.post {
            if (imageView.getTag(R.id.blyp_avatar_load_gen) != gen) return@post
            if (imageView.visibility == View.VISIBLE) return@post
            imageView.visibility = View.GONE
            initialView.visibility = View.VISIBLE
            initialView.text = initial
          }
        }
      }
      .start()
  }
}
