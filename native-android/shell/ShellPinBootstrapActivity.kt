package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R

/** Compte existant : enregistre le PIN localement pour payer sans React. */
class ShellPinBootstrapActivity : AppCompatActivity() {
  private var busy = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this) || BlypShellSession.needsOnboarding(this)) {
      finish()
      return
    }
    if (BlypShellPayBootstrap.hasTransactionPin(this)) {
      openShell()
      return
    }
    setContentView(R.layout.blyp_shell_pin_bootstrap)
    applySystemBarAppearance()
    val input = findViewById<EditText>(R.id.blyp_pin_bootstrap_input)
    BlypDigitLines(findViewById<LinearLayout>(R.id.blyp_pin_bootstrap_cells), input, 4, masked = true) { d ->
      if (d.length == 4) submit(input)
    }
    input.requestFocus()
    findViewById<TextView>(R.id.blyp_pin_bootstrap_continue).setOnClickListener { submit(input) }
  }

  private fun submit(input: EditText) {
    if (busy) return
    val pin = input.text.toString().filter { it.isDigit() }
    if (pin.length != 4) {
      toast(getString(R.string.blyp_shell_auth_otp_invalid))
      return
    }
    busy = true
    val btn = findViewById<TextView>(R.id.blyp_pin_bootstrap_continue)
    BlypButtonSpinner.show(btn)
    BlypShellAuthClient.verifyTransactionPinAsync(this, pin) { r ->
      runOnUiThread {
        busy = false
        BlypButtonSpinner.hide(btn)
        when (r) {
          is BlypShellAuthClient.PinCheck.Valid -> openShell()
          is BlypShellAuthClient.PinCheck.Wrong -> {
            input.setText("")
            toast(
              resources.getQuantityString(
                R.plurals.blyp_shell_pin_wrong_remaining,
                r.remaining,
                r.remaining,
              ),
            )
          }
          is BlypShellAuthClient.PinCheck.Locked -> {
            input.setText("")
            val min = ((r.retryAfterSec + 59) / 60).coerceAtLeast(1)
            toast(getString(R.string.blyp_shell_pin_locked, min))
          }
          is BlypShellAuthClient.PinCheck.Failed ->
            toast(getString(R.string.blyp_shell_settings_failed))
        }
      }
    }
  }

  private fun openShell() {
    startActivity(
      Intent(this, BlypNativeShellActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      },
    )
    finish()
  }

  private fun applySystemBarAppearance() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    window.setBackgroundDrawableResource(R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, true)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  companion object {
    fun startIfNeeded(context: Context): Boolean {
      if (!BlypShellPayBootstrap.needsPinBootstrap(context)) return false
      context.startActivity(
        Intent(context, ShellPinBootstrapActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        },
      )
      return true
    }
  }
}
