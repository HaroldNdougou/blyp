package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.haroldndougou.blyp.R
import java.util.concurrent.Executor

/** Auth biométrique / PIN Blyp puis POST /payments/pay (coque native). */
class ShellPayAuthActivity : FragmentActivity() {
  private var amountFcfa: Int = 0
  private var authStarted = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    @Suppress("DEPRECATION")
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    amountFcfa = intent.getIntExtra(EXTRA_AMOUNT, 0)
    if (amountFcfa <= 0 || !BlypShellPayRuntime.isReady(this)) {
      toast(getString(R.string.quick_pay_not_ready))
      finish()
      return
    }
    setContentView(android.widget.FrameLayout(this))
  }

  override fun onResume() {
    super.onResume()
    if (authStarted || amountFcfa <= 0) return
    startBiometricAuth()
  }

  private fun startBiometricAuth() {
    if (authStarted || isFinishing) return
    val allowed =
      BiometricManager.Authenticators.BIOMETRIC_STRONG or
        BiometricManager.Authenticators.BIOMETRIC_WEAK or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL
    val can =
      try {
        BiometricManager.from(this).canAuthenticate(allowed)
      } catch (_: Exception) {
        authStarted = true
        showBlypPinFallback()
        return
      }
    if (can != BiometricManager.BIOMETRIC_SUCCESS) {
      authStarted = true
      showBlypPinFallback()
      return
    }
    authStarted = true
    val amount = amountFcfa
    try {
    val executor: Executor = ContextCompat.getMainExecutor(this)
    val prompt =
      BiometricPrompt(
        this,
        executor,
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (
              errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                errorCode == BiometricPrompt.ERROR_CANCELED
            ) {
              finish()
              return
            }
            showBlypPinFallback()
          }

          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            window.decorView.post {
              if (!isFinishing) runPay(amount)
            }
          }

          override fun onAuthenticationFailed() {
            /* retry via prompt */
          }
        },
      )
    val info =
      BiometricPrompt.PromptInfo.Builder()
        .setTitle(getString(R.string.quick_pay_auth_title))
        .setSubtitle(getString(R.string.quick_pay_auth_subtitle, amount))
        .setAllowedAuthenticators(allowed)
        .build()
    prompt.authenticate(info)
    } catch (_: Exception) {
      showBlypPinFallback()
    }
  }

  private fun showBlypPinFallback() {
    val snap = BlypShellPayRuntime.read(this) ?: run {
      toast(getString(R.string.quick_pay_not_ready))
      finish()
      return
    }
    val amount = amountFcfa
    var sent = false
    lateinit var dialog: android.app.Dialog
    fun tryPin(pin: String) {
      if (sent) return
      if (pin.length != 4 || pin != snap.transactionPin) {
        sent = true
        toast(getString(R.string.quick_pay_blyp_pin_wrong))
        finish()
        return
      }
      sent = true
      dialog.dismiss()
      runPay(amount)
    }
    val (pinBox, input) = blypMaskedPin(this) { tryPin(it) }
    dialog = BlypShellDialogs.alertBuilder(this)
      .setTitle(getString(R.string.quick_pay_blyp_pin_title))
      .setView(pinBox)
      .setCancelable(true)
      .setOnCancelListener { finish() }
      .setPositiveButton(android.R.string.ok) { _, _ ->
        tryPin(input.text.toString().replace(Regex("\\D"), ""))
      }
      .create()
    dialog.show()
  }

  private fun runPay(amount: Int) {
    try {
      runPayInner(amount)
    } catch (_: Exception) {
      toast(getString(R.string.quick_pay_not_ready))
      finish()
    }
  }

  private fun runPayInner(amount: Int) {
    val snapNow = BlypShellPayRuntime.read(this)
    val commerceNearby = snapNow != null && BlypShellInstantCommercePay.isCommerceRecipient(snapNow)
    val arrowPay =
      snapNow != null &&
        BlypShellPayRuntime.activeRecipientFromBle(this) &&
        !commerceNearby
    if (!commerceNearby && !arrowPay && !BlypShellNetwork.isOnline(this)) {
      toast(getString(R.string.blyp_shell_pay_no_internet))
      finish()
      return
    }
    when (BlypShellInstantCommercePay.runAfterAuth(this, amount)) {
      BlypShellInstantCommercePay.Outcome.Started -> {
        BlypShellPayFeedback.markPaySuccess(amount)
        BlypShellUiRefresh.notifyWalletChanged()
        toast(getString(R.string.quick_pay_success))
        finish()
        return
      }
      BlypShellInstantCommercePay.Outcome.Denied -> {
        finish()
        return
      }
      BlypShellInstantCommercePay.Outcome.NotCommerce -> Unit
    }
    if (!BlypShellPayDossierStore.isBalanceSufficientForPay(this, amount)) {
      showInsufficientBalanceDialog()
      return
    }
    val snap = BlypShellPayRuntime.read(this) ?: run {
      toast(getString(R.string.quick_pay_not_ready))
      finish()
      return
    }
    val prevBal =
      BlypShellPayDossierStore.readVerified(this)?.balanceFcfa ?: snap.balanceFcfa
    val idem = java.util.UUID.randomUUID().toString()
    BlypShellPayRuntime.updateBalance(this, prevBal - amount)
    BlypShellPayFeedback.markPaySuccess(amount)
    BlypShellUiRefresh.notifyWalletChanged()
    if (arrowPay && snapNow != null) {
      BlypShellInstantCommercePay.deliverArrow(this, amount, snapNow)
      ShellNearbyCashActivity.start(applicationContext, amount)
    }
    toast(getString(R.string.quick_pay_success))
    finish()
    BlypShellPayExecutor.payAsync(applicationContext, amount, { pay ->
      when {
        pay.ok -> Unit
        pay.message == "insufficient_balance" -> {
          BlypShellPayRuntime.updateBalance(applicationContext, prevBal)
          BlypShellUiRefresh.notifyWalletChanged()
        }
        pay.message == "no_recipient" || pay.message == "not_configured" -> {
          BlypShellPayRuntime.updateBalance(applicationContext, prevBal)
          BlypShellUiRefresh.notifyWalletChanged()
        }
        BlypShellNetwork.isRetryablePayFailure(pay.message) -> {
          BlypShellOfflinePayQueue.enqueue(
            applicationContext,
            amount,
            idem,
            snap.recipientJson,
          )
          BlypShellOfflinePayQueue.flush(applicationContext)
        }
        else -> {
          BlypShellPayRuntime.updateBalance(applicationContext, prevBal)
          BlypShellUiRefresh.notifyWalletChanged()
        }
      }
    }, idem)
  }

  private fun showInsufficientBalanceDialog() {
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_pay_insufficient_title)
      .setMessage(R.string.blyp_shell_pay_insufficient_message)
      .setCancelable(true)
      .setOnCancelListener { finish() }
      .setNegativeButton(android.R.string.cancel) { _, _ -> finish() }
      .setPositiveButton(R.string.blyp_shell_pay_top_up) { _, _ ->
        PayShellHandoff.openDeposit(this)
        finish()
      }
      .show()
  }

  private fun handoffToRnPay(amount: Int) {
    PayShellHandoff.openPickRecipient(this, amount)
    finish()
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  companion object {
    const val EXTRA_AMOUNT = "amountFcfa"

    fun start(context: Context, amountFcfa: Int) {
      val intent =
        Intent(context, ShellPayAuthActivity::class.java).apply {
          putExtra(EXTRA_AMOUNT, amountFcfa)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      context.startActivity(intent)
    }
  }
}
