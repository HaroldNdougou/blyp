package com.haroldndougou.blyp.shell

import android.annotation.SuppressLint
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Montants rapides sur l’overlay Pay (coque + cold start). */
object PayOverlayUi {
  val QUICK_AMOUNTS = intArrayOf(100, 350, 500, 600)

  @SuppressLint("ClickableViewAccessibility")
  fun bindQuickAmounts(
    root: View,
    setAmount: (Int) -> Unit,
    refreshDisplay: () -> Unit,
    onQuickPay: ((Int) -> Unit)? = null,
  ) {
    val row = root.findViewById<LinearLayout>(R.id.blyp_pay_quick_row) ?: return
    row.removeAllViews()
    val ctx = root.context
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val fmt = NumberFormat.getIntegerInstance(locale)
    val gap = (8 * ctx.resources.displayMetrics.density).toInt()
    QUICK_AMOUNTS.forEachIndexed { i, amount ->
      val label = fmt.format(amount)
      val chip =
        TextView(ctx, null, 0, R.style.BlypColdQuickChip).apply {
          text = label
          contentDescription = ctx.getString(R.string.blyp_shell_pay_quick_a11y, label)
          val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
          if (i > 0) lp.marginStart = gap
          layoutParams = lp
          var deselectTap = false
          setOnTouchListener { v, ev ->
            if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
              deselectTap = v.isSelected
              if (deselectTap) {
                selectQuickChip(row, null)
                setAmount(0)
              } else {
                selectQuickChip(row, v)
                setAmount(amount)
              }
              refreshDisplay()
            }
            false
          }
          setOnClickListener {
            if (deselectTap) {
              deselectTap = false
              return@setOnClickListener
            }
            onQuickPay?.invoke(amount)
          }
        }
      row.addView(chip)
    }
  }

  /** Vert seulement après un tap rapide — effacé dès qu’on tape au clavier. */
  fun clearQuickSelection(root: View) {
    val row = root.findViewById<LinearLayout>(R.id.blyp_pay_quick_row) ?: return
    selectQuickChip(row, null)
  }

  fun hasQuickSelection(root: View): Boolean {
    val row = root.findViewById<LinearLayout>(R.id.blyp_pay_quick_row) ?: return false
    return (0 until row.childCount).any { row.getChildAt(it).isSelected }
  }

  private fun selectQuickChip(row: LinearLayout, chip: View?) {
    val ctx = row.context
    for (i in 0 until row.childCount) {
      val c = row.getChildAt(i) as? TextView ?: continue
      val sel = c === chip
      c.isSelected = sel
      c.setTextColor(
        ctx.getColor(if (sel) R.color.blyp_cold_start_accent else R.color.blyp_cold_start_text_muted),
      )
    }
  }

  /** Touche ↑ grise tant qu’il n’y a pas de montant. */
  fun syncPayKey(root: View, amountFcfa: Int) {
    root.findViewById<View>(R.id.blyp_key_pay)?.isEnabled = amountFcfa > 0
  }
}
