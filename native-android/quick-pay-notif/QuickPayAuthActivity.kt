package com.haroldndougou.blyp.quickpaynotif

import android.app.ActivityOptions
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

/**
 * Activité transparente : une seule invite (empreinte ou code téléphone), puis paiement HTTP.
 */
class QuickPayAuthActivity : FragmentActivity() {
  private var amountFcfa: Int = 0
  private var authStarted = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      setInheritShowWhenLocked(true)
    }
    @Suppress("DEPRECATION")
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON,
    )

    amountFcfa = intent.getIntExtra(EXTRA_AMOUNT, 0)
    if (amountFcfa <= 0) {
      finish()
      return
    }
    QuickPayNotifService.highlightAmount(this, amountFcfa)
    if (!QuickPayNativeSecrets.isReady(this)) {
      toast(getString(R.string.quick_pay_not_ready))
      QuickPayNotifService.clearHighlight(this)
      finish()
      return
    }
  }

  override fun onResume() {
    super.onResume()
    if (authStarted || amountFcfa <= 0) return
    window.decorView.post { startBiometricAuth() }
  }

  private fun startBiometricAuth() {
    if (authStarted || isFinishing) return
    val allowed =
      BiometricManager.Authenticators.BIOMETRIC_STRONG or
        BiometricManager.Authenticators.BIOMETRIC_WEAK or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL
    val can =
      BiometricManager.from(this).canAuthenticate(allowed)
    if (can != BiometricManager.BIOMETRIC_SUCCESS) {
      authStarted = true
      showBlypPinFallback()
      return
    }
    authStarted = true
    val amount = amountFcfa
    val executor: Executor = ContextCompat.getMainExecutor(this)
    val prompt =
      BiometricPrompt(
        this,
        executor,
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
              errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
              errorCode == BiometricPrompt.ERROR_CANCELED
            ) {
              QuickPayNotifService.clearHighlight(this@QuickPayAuthActivity)
              finish()
              return
            }
            showBlypPinFallback()
          }

          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            runPay(amount)
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
  }

  private fun showBlypPinFallback() {
    val snap = QuickPayNativeSecrets.read(this) ?: run {
      toast(getString(R.string.quick_pay_not_ready))
      QuickPayNotifService.clearHighlight(this)
      finish()
      return
    }
    val amount = amountFcfa
    val input = android.widget.EditText(this).apply {
      inputType =
        android.text.InputType.TYPE_CLASS_NUMBER or
          android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
      maxLines = 1
      filters = arrayOf(android.text.InputFilter.LengthFilter(4))
    }
    android.app.AlertDialog.Builder(this)
      .setTitle(getString(R.string.quick_pay_blyp_pin_title))
      .setView(input)
      .setCancelable(true)
      .setOnCancelListener {
        QuickPayNotifService.clearHighlight(this)
        finish()
      }
      .setPositiveButton(android.R.string.ok) { _, _ ->
        val pin = input.text.toString().replace(Regex("\\D"), "")
        if (pin.length != 4 || pin != snap.transactionPin) {
          toast(getString(R.string.quick_pay_blyp_pin_wrong))
          QuickPayNotifService.clearHighlight(this)
          finish()
          return@setPositiveButton
        }
        runPay(amount)
      }
      .show()
  }

  private fun runPay(amount: Int) {
    QuickPayExecutor.payAsync(this, amount) { pay ->
      runOnUiThread {
        if (pay.ok) {
          toast(getString(R.string.quick_pay_success))
          QuickPayNotifBridge.emitPayCompleted(
            this,
            amount,
            pay.balanceFcfa,
            pay.transactionId,
          )
        } else {
          val msg =
            when (pay.message) {
              "insufficient_balance" -> getString(R.string.quick_pay_insufficient)
              "not_configured", "no_recipient" -> getString(R.string.quick_pay_not_ready)
              else -> getString(R.string.quick_pay_failed)
            }
          toast(msg)
        }
        QuickPayNotifService.clearHighlight(this)
        finish()
      }
    }
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  companion object {
    const val EXTRA_AMOUNT = "amountFcfa"

    fun start(context: Context, amountFcfa: Int) {
      val intent =
        Intent(context, QuickPayAuthActivity::class.java).apply {
          putExtra(EXTRA_AMOUNT, amountFcfa)
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_CLEAR_TOP or
              Intent.FLAG_ACTIVITY_NO_HISTORY or
              Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
          )
        }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val opts =
          ActivityOptions.makeBasic().apply {
            setPendingIntentBackgroundActivityStartMode(
              ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED,
            )
          }.toBundle()
        context.startActivity(intent, opts)
      } else {
        context.startActivity(intent)
      }
    }
  }
}
