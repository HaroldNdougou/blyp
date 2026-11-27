package com.haroldndougou.blyp.shell

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import kotlin.random.Random

/** Barres d’un vocal : onde figée, ou qui défile pendant l’enregistrement. */
class BlypShellVoiceWaveView
@JvmOverloads
constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : View(context, attrs) {
  private val bars = FloatArray(36) { 0.22f }
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var seedId: String? = null
  private var live = false
  private var fraction = 0f
  private var split = false
  private var played = 0xFFFFFFFF.toInt()
  private var idle = 0x66FFFFFF

  fun colors(full: Int, dim: Int) {
    played = full
    idle = dim
    invalidate()
  }

  fun seed(id: String) {
    if (seedId == id && !live) return
    seedId = id
    live = false
    val rnd = Random(id.hashCode().toLong() and 0x7fffffff)
    for (i in bars.indices) bars[i] = 0.22f + rnd.nextFloat() * 0.78f
    invalidate()
  }

  fun resetLive() {
    live = true
    seedId = null
    bars.fill(0.18f)
    fraction = 1f
    split = false
    invalidate()
  }

  fun pushLevel(amp: Int) {
    live = true
    val h =
      if (amp < 700) 0.18f else (0.18f + amp / 32767f * 0.82f).coerceIn(0.18f, 1f)
    System.arraycopy(bars, 1, bars, 0, bars.lastIndex)
    bars[bars.lastIndex] = h
    invalidate()
  }

  fun freeze() {
    live = false
    fraction = 0f
    split = true
    invalidate()
  }

  fun setFraction(value: Float, dimTail: Boolean) {
    fraction = value.coerceIn(0f, 1f)
    split = dimTail
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val n = bars.size
    if (n == 0 || width <= 0 || height <= 0) return
    val gap = width / (n * 3.2f)
    val bw = ((width - gap * (n + 1)) / n).coerceAtLeast(1f)
    val maxH = height * 0.92f
    for (i in bars.indices) {
      val head = (i + 0.5f) / n
      paint.color = if (live || (split && head <= fraction) || (!split && !live)) played else idle
      val bh = (bars[i] * maxH).coerceAtLeast(bw)
      val x = gap + i * (bw + gap)
      val top = (height - bh) / 2f
      canvas.drawRoundRect(x, top, x + bw, top + bh, bw, bw, paint)
    }
  }
}
