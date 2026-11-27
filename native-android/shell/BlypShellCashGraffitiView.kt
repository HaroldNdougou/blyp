package com.haroldndougou.blyp.shell

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R

/** Confettis doux au moment où on récupère l’argent. */
class BlypShellCashGraffitiView
@JvmOverloads
constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val accent = ContextCompat.getColor(context, R.color.blyp_shell_accent)
  private val ink = ContextCompat.getColor(context, R.color.blyp_shell_cash_text)
  private val seen = ContextCompat.getColor(context, R.color.blyp_shell_seen)
  private val bits = ArrayList<Bit>(18)
  private var progress = 0f
  private var running: ValueAnimator? = null
  private var tries = 0

  fun play() {
    running?.cancel()
    bringToFront()
    visibility = VISIBLE
    alpha = 1f
    progress = 0f
    tries = 0
    post { start() }
  }

  private fun start() {
    if (width <= 0 || height <= 0) {
      if (tries++ > 4) return
      post { start() }
      return
    }
    tries = 0
    if (bits.isEmpty()) seed()
    val anim =
      ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1100
        interpolator = LinearInterpolator()
        addUpdateListener {
          progress = it.animatedValue as Float
          invalidate()
        }
        addListener(
          object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
              if (running !== animation) return
              visibility = GONE
              progress = 0f
              running = null
            }
          },
        )
      }
    running = anim
    anim.start()
  }

  private fun seed() {
    val rnd = java.util.Random(11)
    val colors = intArrayOf(accent, ink, seen)
    bits.clear()
    repeat(18) { i ->
      bits.add(
        Bit(
          x0 = 0.32f + rnd.nextFloat() * 0.36f,
          y0 = 0.28f + rnd.nextFloat() * 0.2f,
          vx = (rnd.nextFloat() - 0.5f) * 0.85f,
          vy = -0.28f - rnd.nextFloat() * 0.42f,
          spin = (rnd.nextFloat() - 0.5f) * 200f,
          w = 0.07f + rnd.nextFloat() * 0.04f,
          h = 0.035f + rnd.nextFloat() * 0.02f,
          color = colors[i % colors.size],
          delay = rnd.nextFloat() * 0.08f,
        ),
      )
    }
  }

  override fun onTouchEvent(event: android.view.MotionEvent): Boolean = false

  override fun onDraw(canvas: Canvas) {
    val shown = progress
    if (shown <= 0f || width <= 0 || height <= 0) return
    val w = width.toFloat()
    val h = height.toFloat()
    paint.style = Paint.Style.FILL
    for (bit in bits) {
      val span = (1f - bit.delay).coerceAtLeast(0.2f)
      val t = ((shown - bit.delay) / span).coerceIn(0f, 1f)
      if (t <= 0f) continue
      val fade =
        when {
          t < 0.12f -> t / 0.12f
          t > 0.62f -> ((1f - t) / 0.38f).coerceAtLeast(0f)
          else -> 1f
        }
      val x = (bit.x0 + bit.vx * t) * w
      val y = (bit.y0 + bit.vy * t + 0.95f * t * t) * h
      val pw = bit.w * w
      val ph = bit.h * h
      canvas.save()
      canvas.rotate(bit.spin * t, x, y)
      paint.color = bit.color
      paint.alpha = (fade * 235f).toInt().coerceIn(0, 255)
      canvas.drawRoundRect(x, y, x + pw, y + ph, ph / 2f, ph / 2f, paint)
      canvas.restore()
    }
  }

  private class Bit(
    val x0: Float,
    val y0: Float,
    val vx: Float,
    val vy: Float,
    val spin: Float,
    val w: Float,
    val h: Float,
    val color: Int,
    val delay: Float,
  )
}
