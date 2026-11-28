package com.haroldndougou.blyp.shell

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.lang.ref.WeakReference
import java.net.ProxySelector
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/** Aperçu carte : tuiles OSM/Carto, sinon carte stylisée locale. */
object BlypShellPlaceMapLoader {
  private const val ZOOM = 15
  private val main = Handler(Looper.getMainLooper())
  private val cache = ConcurrentHashMap<String, Bitmap>()
  private val http =
    OkHttpClient.Builder()
      .proxySelector(ProxySelector.getDefault())
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(12, TimeUnit.SECONDS)
      .build()
  private val hosts =
    arrayOf(
      "https://tile.openstreetmap.org",
      "https://a.basemaps.cartocdn.com/rastertiles/voyager",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager",
    )

  fun bind(view: ImageView, lat: Double, lng: Double) {
    val d = view.resources.displayMetrics.density
    val outW = (248 * d).toInt().coerceIn(240, 720)
    val outH = (140 * d).toInt().coerceIn(120, 400)
    val key = "${"%.5f".format(java.util.Locale.US, lat)},${"%.5f".format(java.util.Locale.US, lng)}:$outW:$outH"
    view.tag = key
    val hit = cache[key]
    if (hit != null && !hit.isRecycled) {
      view.setImageBitmap(hit)
      return
    }
    val placeholder = styledFallback(outW, outH)
    view.setImageBitmap(placeholder)
    val weak = WeakReference(view)
    Thread {
        val bmp =
          try {
            buildMap(lat, lng, outW, outH)
          } catch (_: Exception) {
            null
          }
        if (bmp == null) return@Thread
        cache[key] = bmp
        main.post {
          val v = weak.get() ?: return@post
          if (v.tag != key) return@post
          v.setImageBitmap(bmp)
        }
      }
      .start()
  }

  private fun buildMap(lat: Double, lng: Double, outW: Int, outH: Int): Bitmap? {
    val n = 1 shl ZOOM
    val xFloat = ((lng + 180.0) / 360.0) * n
    val latRad = lat * PI / 180.0
    val yFloat =
      (1.0 - ln(tan(latRad) + 1.0 / kotlin.math.cos(latRad)) / PI) / 2.0 * n
    val tileX = floor(xFloat).toInt().coerceIn(0, n - 1)
    val tileY = floor(yFloat).toInt().coerceIn(0, n - 1)
    val left = if ((xFloat - tileX) < 0.5) tileX - 1 else tileX
    val top = if ((yFloat - tileY) < 0.5) tileY - 1 else tileY
    val tiles = Array(2) { Array<Bitmap?>(2) { null } }
    var any = false
    for (dy in 0..1) {
      for (dx in 0..1) {
        val tx = ((left + dx) % n + n) % n
        val ty = (top + dy).coerceIn(0, n - 1)
        val tile = fetchTile(tx, ty)
        tiles[dy][dx] = tile
        if (tile != null) any = true
      }
    }
    if (!any) return null
    val tileSize = tiles.firstNotNullOfOrNull { row -> row.firstOrNull { it != null } }?.width ?: 256
    val stitched = Bitmap.createBitmap(tileSize * 2, tileSize * 2, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(stitched)
    canvas.drawColor(0xFFE8EEE8.toInt())
    for (dy in 0..1) {
      for (dx in 0..1) {
        val t = tiles[dy][dx] ?: continue
        canvas.drawBitmap(t, (dx * tileSize).toFloat(), (dy * tileSize).toFloat(), null)
      }
    }
    val pinX = ((xFloat - left) * tileSize).toFloat()
    val pinY = ((yFloat - top) * tileSize).toFloat()
    drawPin(canvas, pinX, pinY, tileSize * 0.055f)
    return Bitmap.createScaledBitmap(stitched, outW, outH, true).also {
      if (it !== stitched) stitched.recycle()
    }
  }

  private fun styledFallback(outW: Int, outH: Int): Bitmap {
    val bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val paint = Paint()
    paint.shader =
      LinearGradient(
        0f,
        0f,
        outW.toFloat(),
        outH.toFloat(),
        intArrayOf(0xFFE9F6E4.toInt(), 0xFFD7ECD8.toInt(), 0xFFC8E0D4.toInt()),
        floatArrayOf(0f, 0.55f, 1f),
        Shader.TileMode.CLAMP,
      )
    canvas.drawRect(0f, 0f, outW.toFloat(), outH.toFloat(), paint)
    val grid =
      Paint().apply {
        color = 0x332E7D32
        strokeWidth = outW * 0.003f
      }
    val step = outW / 6f
    var x = step
    while (x < outW) {
      canvas.drawLine(x, 0f, x, outH.toFloat(), grid)
      x += step
    }
    var y = step
    while (y < outH) {
      canvas.drawLine(0f, y, outW.toFloat(), y, grid)
      y += step
    }
    drawPin(canvas, outW / 2f, outH / 2f, outW * 0.045f)
    return bmp
  }

  private fun drawPin(canvas: Canvas, x: Float, y: Float, r: Float) {
    val ring =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.FILL
      }
    val fill =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#5DC705")
        style = Paint.Style.FILL
      }
    canvas.drawCircle(x, y, r * 1.55f, ring)
    canvas.drawCircle(x, y, r, fill)
  }

  private fun fetchTile(x: Int, y: Int): Bitmap? {
    for (host in hosts) {
      val url = "$host/$ZOOM/$x/$y.png"
      val bmp = fetchUrl(url) ?: continue
      return bmp
    }
    return null
  }

  private fun fetchUrl(url: String): Bitmap? =
    try {
      val req =
        Request.Builder()
          .url(url)
          .header("User-Agent", "BlypPlace/1.0 (https://blyp.app; location preview)")
          .get()
          .build()
      http.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) null
        else resp.body?.byteStream()?.use { BitmapFactory.decodeStream(it) }
      }
    } catch (_: Exception) {
      null
    }
}
