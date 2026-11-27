package com.haroldndougou.blyp.shell

import android.content.Context
import android.util.AttributeSet
import android.widget.TextView
import kotlin.math.ceil

/** Bulle collée au texte, même quand un mot long passe à la ligne. */
class BlypShellTightBubble
@JvmOverloads
constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
) : TextView(context, attrs, defStyleAttr) {
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val mode = MeasureSpec.getMode(widthMeasureSpec)
    val size = MeasureSpec.getSize(widthMeasureSpec)
    val tail = (10f * resources.displayMetrics.density).toInt()
    val spec =
      if (mode != MeasureSpec.UNSPECIFIED && size > tail) {
        MeasureSpec.makeMeasureSpec(size - tail, mode)
      } else {
        widthMeasureSpec
      }
    super.onMeasure(spec, heightMeasureSpec)
    val lines = layout ?: return
    if (lines.lineCount <= 1) return
    var widest = 0f
    for (i in 0 until lines.lineCount) {
      widest = maxOf(widest, lines.getLineWidth(i))
    }
    val tight = ceil(widest).toInt() + compoundPaddingLeft + compoundPaddingRight
    if (tight in 1 until measuredWidth) {
      super.onMeasure(
        MeasureSpec.makeMeasureSpec(tight, MeasureSpec.EXACTLY),
        heightMeasureSpec,
      )
    }
  }
}
