package com.haroldndougou.blyp.shell

import android.app.Dialog
import android.os.Bundle
import android.view.animation.DecelerateInterpolator
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.fragment.app.DialogFragment
import com.haroldndougou.blyp.R

/** Clavier Payer dans le fil (même écran que l’onglet Pay). */
class ShellChatPaySheetDialogFragment : DialogFragment() {
  private var hostId = View.NO_ID
  private var collapseRunnable: Runnable? = null
  private val main = android.os.Handler(android.os.Looper.getMainLooper())

  override fun onCreateDialog(savedInstanceState: Bundle?): Dialog =
    Dialog(requireContext(), R.style.BlypShellDialogTheme)

  override fun onStart() {
    super.onStart()
    val w = dialog?.window ?: return
    w.setLayout(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
    )
    w.setGravity(Gravity.BOTTOM)
  }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    if (hostId == View.NO_ID) hostId = View.generateViewId()
    val host =
      FrameLayout(requireContext()).apply {
        id = hostId
        layoutParams =
          ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          )
      }
    if (savedInstanceState == null) {
      childFragmentManager
        .beginTransaction()
        .replace(hostId, PayShellKeypadFragment())
        .commit()
    }
    return host
  }

  override fun onDestroyView() {
    collapseRunnable?.let { main.removeCallbacks(it) }
    collapseRunnable = null
    super.onDestroyView()
  }

  /** Referme le sheet vers le bas après un paiement réussi. */
  fun collapseAfterPaySuccess() {
    if (!isAdded) return
    collapseRunnable?.let { main.removeCallbacks(it) }
    val run =
      Runnable {
        collapseRunnable = null
        if (!isAdded) return@Runnable
        val panel = view ?: run { dismissAllowingStateLoss(); return@Runnable }
        val h = panel.height
        if (h <= 0) {
          panel.post { collapseAfterPaySuccess() }
          return@Runnable
        }
        panel
          .animate()
          .translationY(h.toFloat())
          .setDuration(220L)
          .setInterpolator(DecelerateInterpolator())
          .withEndAction {
            if (isAdded) dismissAllowingStateLoss()
          }
          .start()
      }
    collapseRunnable = run
    main.postDelayed(run, 380L)
  }
}