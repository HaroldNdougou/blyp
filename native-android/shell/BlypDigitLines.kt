package com.haroldndougou.blyp.shell

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R

/**
 * Saisie à traits type WhatsApp — calquée sur `MaskedPinInput` variant `lines` (RN).
 * L’[EditText] invisible garde le clavier ; [row] dessine les traits. [masked] : points au lieu des chiffres.
 */
class BlypDigitLines(
  private val row: LinearLayout,
  input: EditText,
  private val length: Int,
  private val masked: Boolean,
  private val onDigits: (String) -> Unit = {},
) {
  private val digitViews = ArrayList<TextView>(length)
  private val dotViews = ArrayList<View>(length)
  private val strokeViews = ArrayList<View>(length)
  private val dp = row.resources.displayMetrics.density
  private val idle = ContextCompat.getColor(row.context, R.color.blyp_shell_text_faint)
  private val active = ContextCompat.getColor(row.context, R.color.blyp_shell_accent)
  private val filled = ContextCompat.getColor(row.context, R.color.blyp_shell_text)

  init {
    val ctx = row.context
    repeat(length) {
      val cell =
        LinearLayout(ctx).apply {
          orientation = LinearLayout.VERTICAL
          gravity = Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM
          layoutParams =
            LinearLayout.LayoutParams((48 * dp).toInt(), LinearLayout.LayoutParams.MATCH_PARENT)
              .apply {
                marginStart = (10 * dp).toInt()
                marginEnd = (10 * dp).toInt()
              }
        }
      val stroke = View(ctx)
      if (masked) {
        val dot =
          View(ctx).apply {
            background =
              GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(filled)
              }
            visibility = View.INVISIBLE
            layoutParams =
              LinearLayout.LayoutParams((20 * dp).toInt(), (20 * dp).toInt()).apply {
                bottomMargin = (12 * dp).toInt()
              }
          }
        cell.addView(dot)
        dotViews.add(dot)
      } else {
        val digit =
          TextView(ctx).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER
            fontFeatureSettings = "tnum"
            setTextColor(filled)
            layoutParams =
              LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
              ).apply { bottomMargin = (8 * dp).toInt() }
          }
        cell.addView(digit)
        digitViews.add(digit)
      }
      cell.addView(stroke)
      row.addView(cell)
      strokeViews.add(stroke)
    }
    render("")
    input.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          val d = s?.toString()?.filter { it.isDigit() }?.take(length).orEmpty()
          render(d)
          onDigits(d)
        }
      },
    )
  }

  private fun render(digits: String) {
    for (i in 0 until length) {
      val on = i < digits.length
      val isActive = i == digits.length
      if (masked) dotViews[i].visibility = if (on) View.VISIBLE else View.INVISIBLE
      else digitViews[i].text = if (on) digits[i].toString() else " "
      val stroke = strokeViews[i]
      stroke.setBackgroundColor(if (isActive) active else if (on) filled else idle)
      val h = ((if (isActive) 3 else 2) * dp).toInt()
      val lp = stroke.layoutParams as? LinearLayout.LayoutParams
      if (lp == null || lp.height != h) {
        stroke.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, h)
      }
    }
  }
}
