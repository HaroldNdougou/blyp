package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R

/** Code secret actuel, puis nouveau, puis confirmation. */
class ShellChangePinActivity : AppCompatActivity() {
  private var step = 0
  private var busy = false
  private var currentPin = ""
  private var newPin = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_pin_change)
    applyBars()
    val input = findViewById<EditText>(R.id.blyp_pin_change_input)
    BlypDigitLines(findViewById<LinearLayout>(R.id.blyp_pin_change_cells), input, 4, masked = true) { digits ->
      if (digits.length == 4) onFour(digits, input)
    }
    findViewById<View>(R.id.blyp_pin_change_back).setOnClickListener { onBackStep(input) }
    showStep(0, input)
  }

  override fun onResume() {
    super.onResume()
    focusInput()
  }

  private fun onBackStep(input: EditText) {
    if (busy) return
    if (step == 0) {
      finish()
      return
    }
    step -= 1
    showStep(step, input)
  }

  private fun showStep(index: Int, input: EditText) {
    step = index
    val lead = findViewById<TextView>(R.id.blyp_pin_change_lead)
    lead.setText(
      when (index) {
        0 -> R.string.blyp_shell_pin_change_current
        1 -> R.string.blyp_shell_pin_change_new
        else -> R.string.blyp_shell_pin_change_confirm
      },
    )
    input.setText("")
    focusInput()
  }

  private fun onFour(digits: String, input: EditText) {
    if (busy) return
    when (step) {
      0 -> verifyCurrent(digits, input)
      1 -> {
        if (digits == currentPin) {
          toast(getString(R.string.blyp_shell_pin_change_same))
          input.setText("")
          return
        }
        newPin = digits
        showStep(2, input)
      }
      else -> {
        if (digits != newPin) {
          toast(getString(R.string.blyp_shell_onboarding_pin_mismatch))
          input.setText("")
          return
        }
        submit(digits)
      }
    }
  }

  private fun verifyCurrent(digits: String, input: EditText) {
    busy = true
    BlypShellAuthClient.verifyTransactionPinAsync(this, digits) { result ->
      runOnUiThread {
        busy = false
        when (result) {
          is BlypShellAuthClient.PinCheck.Valid -> {
            currentPin = digits
            showStep(1, input)
          }
          is BlypShellAuthClient.PinCheck.Wrong -> {
            input.setText("")
            toast(
              resources.getQuantityString(
                R.plurals.blyp_shell_pin_wrong_remaining,
                result.remaining,
                result.remaining,
              ),
            )
          }
          is BlypShellAuthClient.PinCheck.Locked -> {
            input.setText("")
            val min = (result.retryAfterSec + 59) / 60
            toast(getString(R.string.blyp_shell_pin_locked, min.coerceAtLeast(1)))
          }
          BlypShellAuthClient.PinCheck.Failed -> {
            input.setText("")
            toast(getString(R.string.blyp_shell_pin_change_failed))
          }
        }
      }
    }
  }

  private fun submit(digits: String) {
    busy = true
    BlypShellAuthClient.changeTransactionPinAsync(this, currentPin, digits) { result ->
      runOnUiThread {
        busy = false
        when (result) {
          is BlypShellAuthClient.PinCheck.Valid -> {
            toast(getString(R.string.blyp_shell_pin_change_saved))
            finish()
          }
          is BlypShellAuthClient.PinCheck.Wrong -> {
            step = 0
            currentPin = ""
            newPin = ""
            findViewById<EditText>(R.id.blyp_pin_change_input).setText("")
            showStep(0, findViewById(R.id.blyp_pin_change_input))
            toast(
              resources.getQuantityString(
                R.plurals.blyp_shell_pin_wrong_remaining,
                result.remaining,
                result.remaining,
              ),
            )
          }
          is BlypShellAuthClient.PinCheck.Locked -> {
            val min = (result.retryAfterSec + 59) / 60
            toast(getString(R.string.blyp_shell_pin_locked, min.coerceAtLeast(1)))
            finish()
          }
          BlypShellAuthClient.PinCheck.Failed -> {
            toast(getString(R.string.blyp_shell_pin_change_failed))
          }
        }
      }
    }
  }

  private fun focusInput() {
    val input = findViewById<EditText>(R.id.blyp_pin_change_input) ?: return
    window.setSoftInputMode(
      WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
        WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE,
    )
    val imm = getSystemService(InputMethodManager::class.java) ?: return
    val open = Runnable {
      input.requestFocus()
      imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }
    input.post(open)
    input.postDelayed(open, 280)
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  private fun applyBars() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    window.setBackgroundDrawableResource(R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, true)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellChangePinActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}
