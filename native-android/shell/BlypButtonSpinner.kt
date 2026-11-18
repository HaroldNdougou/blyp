package com.haroldndougou.blyp.shell

import android.content.res.ColorStateList
import android.graphics.Color
import android.view.View
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.CircularProgressDrawable
import com.haroldndougou.blyp.R

/**
 * Spinner dessiné par-dessus le bouton (overlay) — aucun changement de layout, aucun délai sur l’action.
 * Texte masqué pendant l’attente ; restauré par [hide].
 */
object BlypButtonSpinner {
  private const val TAG_DRAWABLE = R.id.blyp_button_spinner_drawable
  private const val TAG_COLORS = R.id.blyp_button_spinner_colors

  fun show(view: View?) {
    view ?: return
    if (view.getTag(TAG_DRAWABLE) != null) return
    val density = view.resources.displayMetrics.density
    val tint = (view as? TextView)?.currentTextColor
      ?: ContextCompat.getColor(view.context, R.color.blyp_shell_accent)
    val d = CircularProgressDrawable(view.context).apply {
      setStyle(CircularProgressDrawable.DEFAULT)
      strokeWidth = 2.5f * density
      centerRadius = 8f * density
      setColorSchemeColors(tint)
    }
    val place = {
      val size = (24 * density).toInt()
      val l = (view.width - size) / 2
      val t = (view.height - size) / 2
      d.setBounds(l, t, l + size, t + size)
    }
    if (view.width == 0) view.post(place) else place()
    if (view is TextView) {
      view.setTag(TAG_COLORS, view.textColors)
      view.setTextColor(Color.TRANSPARENT)
    }
    view.overlay.add(d)
    view.setTag(TAG_DRAWABLE, d)
    d.start()
  }

  fun hide(view: View?) {
    view ?: return
    val d = view.getTag(TAG_DRAWABLE) as? CircularProgressDrawable ?: return
    d.stop()
    view.overlay.remove(d)
    view.setTag(TAG_DRAWABLE, null)
    (view.getTag(TAG_COLORS) as? ColorStateList)?.let { (view as? TextView)?.setTextColor(it) }
    view.setTag(TAG_COLORS, null)
  }

  fun set(view: View?, on: Boolean) = if (on) show(view) else hide(view)
}
