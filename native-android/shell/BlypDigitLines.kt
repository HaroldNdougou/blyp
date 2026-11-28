package com.haroldndougou.blyp.shell

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.text.method.PasswordTransformationMethod
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
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

/** Champ code : traits et points seulement, jamais les chiffres. [onComplete] part dès le dernier chiffre. */
fun blypMaskedPin(
  context: Context,
  length: Int = 4,
  onComplete: (String) -> Unit = {},
): Pair<View, EditText> {
  val dp = context.resources.displayMetrics.density
  val frame =
    FrameLayout(context).apply {
      layoutParams =
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT,
          (64 * dp).toInt(),
        )
    }
  val row =
    LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      layoutParams =
        FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.MATCH_PARENT,
        )
    }
  val input =
    EditText(context).apply {
      layoutParams =
        FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.MATCH_PARENT,
        )
      alpha = 0f
      setTextColor(Color.TRANSPARENT)
      setBackgroundColor(Color.TRANSPARENT)
      isCursorVisible = false
      isLongClickable = false
      setTextIsSelectable(false)
      importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
      inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
      transformationMethod = PasswordTransformationMethod.getInstance()
      filters =
        arrayOf(
          InputFilter.LengthFilter(length),
          InputFilter { source, start, end, _, _, _ ->
            for (i in start until end) {
              if (!source[i].isDigit()) return@InputFilter ""
            }
            null
          },
        )
    }
  frame.addView(row)
  frame.addView(input)
  BlypDigitLines(row, input, length, masked = true) { digits ->
    if (digits.length != length) return@BlypDigitLines
    input.post {
      val now = input.text?.toString()?.filter { it.isDigit() }?.take(length).orEmpty()
      if (now.length == length) onComplete(now)
    }
  }
  return frame to input
}
