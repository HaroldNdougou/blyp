package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Vibration nette à l’arrivée (message, money, paiement) — pas un micro-tap. */
object BlypShellIncomingBuzz {
  fun message(context: Context) {
    pulse(
      context,
      timings = longArrayOf(0, 110, 70, 160),
      amplitudes = intArrayOf(0, 230, 0, 255),
      alarm = false,
    )
  }

  fun money(context: Context) {
    pulse(
      context,
      timings = longArrayOf(0, 160, 90, 220, 90, 300),
      amplitudes = intArrayOf(0, 255, 0, 255, 0, 255),
      alarm = true,
    )
  }

  fun payment(context: Context) = money(context)

  private fun pulse(
    context: Context,
    timings: LongArray,
    amplitudes: IntArray,
    alarm: Boolean,
  ) {
    val app = context.applicationContext
    runCatching {
      val effect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          VibrationEffect.createWaveform(timings, amplitudes, -1)
        } else {
          null
        }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        val vibrator = vm.defaultVibrator
        if (!vibrator.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && effect != null) {
          val usage =
            if (alarm) {
              android.os.VibrationAttributes.USAGE_ALARM
            } else {
              android.os.VibrationAttributes.USAGE_NOTIFICATION
            }
          vibrator.vibrate(effect, android.os.VibrationAttributes.createForUsage(usage))
        } else if (effect != null) {
          vibrator.vibrate(effect)
        }
        return
      }
      @Suppress("DEPRECATION")
      val vibrator = app.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      if (!vibrator.hasVibrator()) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && effect != null) {
        vibrator.vibrate(effect)
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(timings, -1)
      }
    }
  }
}
