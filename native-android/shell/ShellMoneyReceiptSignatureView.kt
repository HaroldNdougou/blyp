package com.haroldndougou.blyp.shell

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R

class ShellMoneyReceiptSignatureView
@JvmOverloads
constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : View(context, attrs) {
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.DKGRAY
    style = Paint.Style.STROKE
    strokeWidth = 5f
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val path = Path()
  private var hasInk = false
  var onSignedChange: ((Boolean) -> Unit)? = null

  fun clear() {
    path.reset()
    hasInk = false
    onSignedChange?.invoke(false)
    invalidate()
  }

  fun isSigned(): Boolean = hasInk

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val bg =
      ContextCompat.getColor(context, R.color.blyp_shell_surface_muted)
    canvas.drawColor(bg)
    canvas.drawPath(path, stroke)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        path.moveTo(event.x, event.y)
        hasInk = true
        onSignedChange?.invoke(true)
      }
      MotionEvent.ACTION_MOVE -> path.lineTo(event.x, event.y)
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        /* keep */
      }
    }
    invalidate()
    return true
  }
}