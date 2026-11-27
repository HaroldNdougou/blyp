package com.haroldndougou.blyp.shell

import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.SeekBar
import androidx.core.content.ContextCompat

object BlypShellClicks {
  fun arm(root: View?) {
    if (root == null) return
    walk(root)
  }

  private fun walk(view: View) {
    if (view.getTag(com.haroldndougou.blyp.R.id.blyp_click_armed) != true) {
      view.setTag(com.haroldndougou.blyp.R.id.blyp_click_armed, true)
      if (view.isClickable && view !is EditText && view !is SeekBar && view.foreground == null) {
        val typed = TypedValue()
        view.context.theme.resolveAttribute(android.R.attr.selectableItemBackground, typed, true)
        if (typed.resourceId != 0) {
          view.foreground = ContextCompat.getDrawable(view.context, typed.resourceId)
        }
      }
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) walk(view.getChildAt(i))
    }
  }
}
