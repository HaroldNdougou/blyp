package com.haroldndougou.blyp.shell

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R
import java.lang.ref.WeakReference
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Pastille haut d’écran : paiement reçu en mode pro, hors onglet Payer.
 * Instantanée (BLE / cache) — calquée sur la bannière Payer perso.
 */
object BlypShellReceivedPill {
  private val installed = AtomicBoolean(false)
  private val main = Handler(Looper.getMainLooper())
  private var current: WeakReference<Activity>? = null
  private var hideAt = 0L
  private val hide = Runnable {
    val act = current?.get() ?: return@Runnable
    pillOf(act)?.visibility = View.GONE
  }

  fun foreground(): Activity? = current?.get()

  fun install(app: Application) {
    if (!installed.compareAndSet(false, true)) return
    app.registerActivityLifecycleCallbacks(
      object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
          current = WeakReference(activity)
        }

        override fun onActivityPaused(activity: Activity) {
          if (current?.get() === activity) current = WeakReference(null)
        }

        override fun onActivityCreated(a: Activity, b: Bundle?) {}
        override fun onActivityStarted(a: Activity) {}
        override fun onActivityStopped(a: Activity) {}
        override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
      },
    )
    BlypShellIncomingFlash.subscribe { event ->
      val act = current?.get() ?: return@subscribe
      if (act.isFinishing || skipBecausePayScreen(act)) return@subscribe
      show(act, event.amountFcfa)
    }
  }

  private fun skipBecausePayScreen(activity: Activity): Boolean {
    val shell = activity as? BlypNativeShellActivity ?: return false
    return shell.isPayTabVisible() && BlypShellSession.isCommerceMode(activity)
  }

  private fun show(activity: Activity, amountFcfa: Int) {
    val pill = ensurePill(activity) ?: return
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val fmt = NumberFormat.getIntegerInstance(locale)
    pill.text = activity.getString(R.string.blyp_shell_pay_received_banner, fmt.format(amountFcfa))
    pill.visibility = View.VISIBLE
    hideAt = android.os.SystemClock.elapsedRealtime() + SHOW_MS
    main.removeCallbacks(hide)
    main.postDelayed(hide, SHOW_MS)
  }

  private fun pillOf(activity: Activity): TextView? =
    activity.findViewById(R.id.blyp_shell_received_pill)

  private fun ensurePill(activity: Activity): TextView? {
    pillOf(activity)?.let { return it }
    val parent = activity.findViewById<ViewGroup>(android.R.id.content) ?: return null
    val dp = activity.resources.displayMetrics.density
    val pill =
      TextView(activity).apply {
        id = R.id.blyp_shell_received_pill
        gravity = Gravity.CENTER
        setPadding((14 * dp).toInt(), (10 * dp).toInt(), (14 * dp).toInt(), (10 * dp).toInt())
        setBackgroundResource(R.drawable.blyp_shell_deposit_bg)
        setTextColor(ContextCompat.getColor(activity, R.color.blyp_shell_accent))
        textSize = 14f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        visibility = View.GONE
      }
    val lp =
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      ).apply {
        gravity = Gravity.TOP
        leftMargin = (16 * dp).toInt()
        rightMargin = (16 * dp).toInt()
        topMargin = (8 * dp).toInt()
      }
    parent.addView(pill, lp)
    pill.elevation = 12 * dp
    return pill
  }

  private const val SHOW_MS = 3_500L
}
