package com.haroldndougou.blyp.shell

import android.app.Activity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.haroldndougou.blyp.R
import java.util.WeakHashMap

/** Voile + spinner tant que l’îlot Messages n’a pas peint. */
object BlypShellMessagesLoading {
  private const val HIDE_FALLBACK_MS = 8_000L
  private val hideLater = WeakHashMap<Activity, Runnable>()

  fun attach(activity: Activity) {
    val root = activity.window?.decorView as? ViewGroup ?: return
    if (activity.findViewById<View>(R.id.blyp_shell_messages_loading) != null) return
    val overlay =
      LayoutInflater.from(activity).inflate(R.layout.blyp_shell_messages_loading, root, false)
    overlay.id = R.id.blyp_shell_messages_loading
    root.addView(
      overlay,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    val later = Runnable { hide(activity) }
    hideLater[activity] = later
    overlay.postDelayed(later, HIDE_FALLBACK_MS)
  }

  fun hide(activity: Activity?) {
    val act = activity ?: return
    hideLater.remove(act)?.let { later ->
      act.findViewById<View>(R.id.blyp_shell_messages_loading)?.removeCallbacks(later)
    }
    val overlay = act.findViewById<View>(R.id.blyp_shell_messages_loading) ?: return
    (overlay.parent as? ViewGroup)?.removeView(overlay)
  }
}
