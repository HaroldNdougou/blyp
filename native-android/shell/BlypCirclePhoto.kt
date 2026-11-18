package com.haroldndougou.blyp.shell

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.ImageView
import java.io.File
import kotlin.math.hypot

/** Photo ronde : glisser, pincer, double-tape pour recentrer. */
class BlypCirclePhoto(
  private val image: ImageView,
) {
  private var bmp: Bitmap? = null
  private val photoMatrix = Matrix()
  private var photoScale = 1f
  private var minPhotoScale = 1f
  private var gestureLastX = 0f
  private var gestureLastY = 0f
  private var gestureLastSpan = 0f
  private var gestureMoved = false
  private var lastTapAt = 0L

  fun attach() {
    val slop = ViewConfiguration.get(image.context).scaledTouchSlop
    image.setOnTouchListener { v, event ->
      val current = bmp
      if (current == null || current.isRecycled || image.visibility != View.VISIBLE) {
        return@setOnTouchListener false
      }
      var parent = v.parent
      while (parent != null) {
        parent.requestDisallowInterceptTouchEvent(true)
        parent = parent.parent
      }
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          gestureLastX = event.x
          gestureLastY = event.y
          gestureMoved = false
          true
        }
        MotionEvent.ACTION_POINTER_DOWN -> {
          gestureLastSpan = pointerSpan(event)
          true
        }
        MotionEvent.ACTION_MOVE -> {
          if (event.pointerCount >= 2 && gestureLastSpan > 0f) {
            val span = pointerSpan(event)
            if (span > 0f) {
              zoom(span / gestureLastSpan, (event.getX(0) + event.getX(1)) / 2f, (event.getY(0) + event.getY(1)) / 2f)
              gestureLastSpan = span
              gestureMoved = true
            }
          } else if (event.pointerCount == 1) {
            val dx = event.x - gestureLastX
            val dy = event.y - gestureLastY
            if (kotlin.math.abs(dx) > slop || kotlin.math.abs(dy) > slop) gestureMoved = true
            photoMatrix.postTranslate(dx, dy)
            clamp()
            image.imageMatrix = photoMatrix
            gestureLastX = event.x
            gestureLastY = event.y
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!gestureMoved) {
            val now = SystemClock.uptimeMillis()
            if (now - lastTapAt < 280) {
              center()
              lastTapAt = 0L
            } else {
              lastTapAt = now
            }
          }
          gestureLastSpan = 0f
          true
        }
        MotionEvent.ACTION_POINTER_UP -> {
          val keep = if (event.actionIndex == 0) 1 else 0
          if (keep < event.pointerCount) {
            gestureLastX = event.getX(keep)
            gestureLastY = event.getY(keep)
          }
          gestureLastSpan = 0f
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          gestureLastSpan = 0f
          true
        }
        else -> false
      }
    }
  }

  fun show(bitmap: Bitmap) {
    bmp?.let { old -> if (old != bitmap && !old.isRecycled) old.recycle() }
    bmp = bitmap
    image.scaleType = ImageView.ScaleType.MATRIX
    image.setImageBitmap(bitmap)
    image.visibility = View.VISIBLE
    center()
  }

  fun hasPhoto(): Boolean = bmp != null && bmp?.isRecycled == false

  fun export(cacheDir: File): File? {
    val current = bmp ?: return null
    if (current.isRecycled) return null
    val vw = image.width
    val vh = image.height
    if (vw <= 0 || vh <= 0) return null
    val size = 512
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val draw = Matrix(photoMatrix)
    draw.postScale(size / vw.toFloat(), size / vh.toFloat())
    canvas.drawBitmap(current, draw, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    val file = File(cacheDir, "avatar-framed-${System.currentTimeMillis()}.jpg")
    return try {
      file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      file.takeIf { it.length() > 0 }
    } catch (_: Exception) {
      null
    } finally {
      out.recycle()
    }
  }

  fun recycle() {
    bmp?.let { if (!it.isRecycled) it.recycle() }
    bmp = null
  }

  private fun center() {
    val current = bmp ?: return
    val w = image.width.toFloat()
    val h = image.height.toFloat()
    if (w <= 0f || h <= 0f) {
      image.post { center() }
      return
    }
    val scale = maxOf(w / current.width, h / current.height)
    minPhotoScale = scale
    photoScale = scale
    photoMatrix.reset()
    photoMatrix.postScale(scale, scale)
    photoMatrix.postTranslate((w - current.width * scale) / 2f, (h - current.height * scale) / 2f)
    image.imageMatrix = photoMatrix
  }

  private fun zoom(factor: Float, focusX: Float, focusY: Float) {
    val next = (photoScale * factor).coerceIn(minPhotoScale, minPhotoScale * 4f)
    if (next == photoScale) return
    photoMatrix.postScale(next / photoScale, next / photoScale, focusX, focusY)
    photoScale = next
    clamp()
    image.imageMatrix = photoMatrix
  }

  private fun clamp() {
    val current = bmp ?: return
    val w = image.width.toFloat()
    val h = image.height.toFloat()
    if (w <= 0f || h <= 0f) return
    val values = FloatArray(9)
    photoMatrix.getValues(values)
    var scale = values[Matrix.MSCALE_X]
    val maxScale = minPhotoScale * 4f
    if (scale < minPhotoScale || scale > maxScale) {
      val target = scale.coerceIn(minPhotoScale, maxScale)
      photoMatrix.postScale(target / scale, target / scale, w / 2f, h / 2f)
      photoMatrix.getValues(values)
      scale = values[Matrix.MSCALE_X]
    }
    photoScale = scale
    val tx = values[Matrix.MTRANS_X]
    val ty = values[Matrix.MTRANS_Y]
    photoMatrix.postTranslate(
      tx.coerceIn(w - current.width * scale, 0f) - tx,
      ty.coerceIn(h - current.height * scale, 0f) - ty,
    )
  }

  private fun pointerSpan(event: MotionEvent): Float {
    if (event.pointerCount < 2) return 0f
    val dx = event.getX(0) - event.getX(1)
    val dy = event.getY(0) - event.getY(1)
    return hypot(dx.toDouble(), dy.toDouble()).toFloat()
  }
}
