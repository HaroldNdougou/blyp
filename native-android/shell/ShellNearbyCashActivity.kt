package com.haroldndougou.blyp.shell

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Animation courte pour un paiement reçu via la flèche, seulement. */
class ShellNearbyCashActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val amount = intent.getIntExtra(EXTRA_AMOUNT, 0).coerceAtLeast(0)
    val density = resources.displayMetrics.density
    val root = FrameLayout(this)
    root.setBackgroundColor(0xE6000000.toInt())
    val size = (280 * density).toInt()
    val orb = android.view.View(this)
    orb.background =
      GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ContextCompat.getColor(this@ShellNearbyCashActivity, R.color.blyp_shell_accent))
      }
    orb.scaleX = 0.2f
    orb.scaleY = 0.2f
    orb.alpha = 0.95f
    root.addView(
      orb,
      FrameLayout.LayoutParams(size, size, Gravity.CENTER),
    )
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val label = TextView(this)
    label.text = NumberFormat.getIntegerInstance(locale).format(amount)
    label.setTextColor(0xFFFFFFFF.toInt())
    label.textSize = 56f
    label.gravity = Gravity.CENTER
    label.alpha = 0f
    root.addView(
      label,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER,
      ),
    )
    setContentView(root)
    buzz()
    orb.animate().scaleX(2.6f).scaleY(2.6f).alpha(0f).setDuration(900).start()
    label.animate().alpha(1f).setStartDelay(120).setDuration(280).start()
    root.setOnClickListener { finish() }
    main.postDelayed({ if (!isFinishing) finish() }, 1600L)
  }

  private fun buzz() {
    val pattern = longArrayOf(0, 280, 140, 280)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val vm = getSystemService(VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager
      val effect = android.os.VibrationEffect.createWaveform(pattern, -1)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        vm.defaultVibrator.vibrate(
          effect,
          android.os.VibrationAttributes.createForUsage(android.os.VibrationAttributes.USAGE_ALARM),
        )
      } else {
        vm.defaultVibrator.vibrate(effect)
      }
      return
    }
    @Suppress("DEPRECATION")
    val vibrator = getSystemService(VIBRATOR_SERVICE) as android.os.Vibrator
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(pattern, -1)
    }
  }

  companion object {
    private const val EXTRA_AMOUNT = "amountFcfa"
    private const val OVERLAY_TAG = "blyp_arrow_cash"

    /** Sur l’écran déjà ouvert : le téléphone qui reçoit ne peut pas lancer une page depuis le Bluetooth. */
    fun present(context: Context, amountFcfa: Int) {
      val amount = amountFcfa.coerceAtLeast(0)
      if (amount <= 0) return
      val run = Runnable {
        val act = BlypShellReceivedPill.foreground()
        if (act != null && !act.isFinishing && attach(act, amount)) return@Runnable
        start(context.applicationContext, amount)
      }
      if (Looper.myLooper() == Looper.getMainLooper()) run.run()
      else Handler(Looper.getMainLooper()).post(run)
    }

    private fun attach(activity: Activity, amount: Int): Boolean {
      val parent = activity.findViewById<android.view.ViewGroup>(android.R.id.content) ?: return false
      parent.findViewWithTag<android.view.View>(OVERLAY_TAG)?.let { parent.removeView(it) }
      val density = activity.resources.displayMetrics.density
      val root = FrameLayout(activity)
      root.tag = OVERLAY_TAG
      root.setBackgroundColor(0xE6000000.toInt())
      val size = (280 * density).toInt()
      val orb = android.view.View(activity)
      orb.background =
        GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(ContextCompat.getColor(activity, R.color.blyp_shell_accent))
        }
      orb.scaleX = 0.2f
      orb.scaleY = 0.2f
      root.addView(orb, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
      val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
      val label = TextView(activity)
      label.text = NumberFormat.getIntegerInstance(locale).format(amount)
      label.setTextColor(0xFFFFFFFF.toInt())
      label.textSize = 56f
      label.gravity = Gravity.CENTER
      label.alpha = 0f
      root.addView(
        label,
        FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
          Gravity.CENTER,
        ),
      )
      parent.addView(
        root,
        android.view.ViewGroup.LayoutParams(
          android.view.ViewGroup.LayoutParams.MATCH_PARENT,
          android.view.ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
      root.elevation = 40 * density
      buzz(activity)
      orb.animate().scaleX(2.6f).scaleY(2.6f).alpha(0f).setDuration(900).start()
      label.animate().alpha(1f).setStartDelay(120).setDuration(280).start()
      val main = Handler(Looper.getMainLooper())
      val gone = Runnable { if (root.parent === parent) parent.removeView(root) }
      root.setOnClickListener { main.removeCallbacks(gone); gone.run() }
      main.postDelayed(gone, 1600L)
      return true
    }

    private fun buzz(context: Context) {
      val pattern = longArrayOf(0, 280, 140, 280)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager
        val effect = android.os.VibrationEffect.createWaveform(pattern, -1)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          vm.defaultVibrator.vibrate(
            effect,
            android.os.VibrationAttributes.createForUsage(android.os.VibrationAttributes.USAGE_ALARM),
          )
        } else {
          vm.defaultVibrator.vibrate(effect)
        }
        return
      }
      @Suppress("DEPRECATION")
      val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(pattern, -1)
      }
    }

    fun start(context: Context, amountFcfa: Int) {
      val intent =
        Intent(context, ShellNearbyCashActivity::class.java).apply {
          putExtra(EXTRA_AMOUNT, amountFcfa)
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_NO_HISTORY or
              Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
          )
        }
      context.startActivity(intent)
    }
  }
}
