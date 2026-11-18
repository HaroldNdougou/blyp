package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.MainActivity
import com.haroldndougou.blyp.R

/** Rechargement wallet natif — sans îlot React. */
class ShellDepositActivity : AppCompatActivity() {
  private var idempotencyKey: String = BlypShellDepositExecutor.newIdempotencyKey()
  private var busy = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_deposit)
    applySystemBarAppearance()
    findViewById<View>(R.id.blyp_deposit_close).setOnClickListener { finish() }
    val amountInput = findViewById<EditText>(R.id.blyp_deposit_amount)
    bindQuick(R.id.blyp_deposit_q500, 500, amountInput)
    bindQuick(R.id.blyp_deposit_q1000, 1000, amountInput)
    bindQuick(R.id.blyp_deposit_q2000, 2000, amountInput)
    bindQuick(R.id.blyp_deposit_q5000, 5000, amountInput)
    findViewById<TextView>(R.id.blyp_deposit_submit).setOnClickListener {
      submit(amountInput)
    }
  }

  private fun bindQuick(viewId: Int, amount: Int, input: EditText) {
    findViewById<TextView>(viewId).setOnClickListener {
      input.setText(amount.toString())
    }
  }

  private fun submit(input: EditText) {
    if (busy) return
    val amount = input.text.toString().replace(Regex("\\D"), "").toIntOrNull() ?: 0
    if (amount <= 0) {
      toast(getString(R.string.blyp_shell_deposit_invalid))
      return
    }
    busy = true
    findViewById<TextView>(R.id.blyp_deposit_submit).alpha = 0.6f
    BlypButtonSpinner.show(findViewById(R.id.blyp_deposit_submit))
    BlypShellDepositExecutor.depositAsync(this, amount, idempotencyKey) { res ->
      runOnUiThread {
        busy = false
        findViewById<TextView>(R.id.blyp_deposit_submit).alpha = 1f
        BlypButtonSpinner.hide(findViewById(R.id.blyp_deposit_submit))
        if (!res.ok) {
          idempotencyKey = BlypShellDepositExecutor.newIdempotencyKey()
          toast(res.message ?: getString(R.string.blyp_shell_deposit_failed))
          return@runOnUiThread
        }
        idempotencyKey = BlypShellDepositExecutor.newIdempotencyKey()
        if (res.completed) {
          BlypShellUiRefresh.notifyWalletChanged()
          toast(getString(R.string.blyp_shell_deposit_success))
          finish()
          return@runOnUiThread
        }
        val intentId = res.depositIntentId
        if (!intentId.isNullOrBlank()) {
          BlypShellPendingDeposit.arm(this, intentId, amount)
          toast(getString(R.string.blyp_shell_deposit_pending))
          finish()
          return@runOnUiThread
        }
        toast(getString(R.string.blyp_shell_deposit_failed))
      }
    }
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
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellDepositActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}
