package com.haroldndougou.blyp.quickpaynotif

import android.app.ActivityOptions
import android.app.KeyguardManager
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
  private var phoneWasLocked = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    phoneWasLocked = keyguard.isKeyguardLocked || keyguard.isDeviceLocked
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
      leaveWithoutApp()
      return
    }
    if (!QuickPayNativeSecrets.isReady(this)) {
      toast(getString(R.string.quick_pay_not_ready))
      QuickPayNotifService.clearHighlight(this)
      leaveWithoutApp()
      return
    }
    QuickPayNotifService.highlightAmount(this, amountFcfa)
  }

  override fun onResume() {
    super.onResume()
    if (authStarted || amountFcfa <= 0) return
    window.decorView.post {
      if (phoneWasLocked) confirmUnlockThenPay() else startBiometricAuth()
    }
  }

  /** Téléphone verrouillé : un seul déverrouillage, puis paiement. */
  private fun confirmUnlockThenPay() {
    if (authStarted || isFinishing) return
    authStarted = true
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (!keyguard.isKeyguardLocked && !keyguard.isDeviceLocked) {
      runPay(amountFcfa)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      runPay(amountFcfa)
      return
    }
    keyguard.requestDismissKeyguard(
      this,
      object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          runPay(amountFcfa)
        }

        override fun onDismissCancelled() {
          QuickPayNotifService.clearHighlight(this@QuickPayAuthActivity)
          leaveWithoutApp()
        }

        override fun onDismissError() {
          QuickPayNotifService.clearHighlight(this@QuickPayAuthActivity)
          leaveWithoutApp()
        }
      },
    )
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
              leaveWithoutApp()
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
      leaveWithoutApp()
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
    com.haroldndougou.blyp.shell.BlypShellDialogs.alertBuilder(this)
      .setTitle(getString(R.string.quick_pay_blyp_pin_title))
      .setView(input)
      .setCancelable(true)
      .setOnCancelListener {
        QuickPayNotifService.clearHighlight(this)
        leaveWithoutApp()
      }
      .setPositiveButton(android.R.string.ok) { _, _ ->
        val pin = input.text.toString().replace(Regex("\\D"), "")
        if (pin.length != 4 || pin != snap.transactionPin) {
          toast(getString(R.string.quick_pay_blyp_pin_wrong))
          QuickPayNotifService.clearHighlight(this)
          leaveWithoutApp()
          return@setPositiveButton
        }
        runPay(amount)
      }
      .show()
  }

  private fun runPay(amount: Int) {
    ensureSharedRecipient()
    if (!com.haroldndougou.blyp.shell.BlypShellNetwork.isOnline(this)) {
      toast(getString(R.string.blyp_shell_pay_no_internet))
      leaveWithoutApp()
      return
    }
    when (com.haroldndougou.blyp.shell.BlypShellInstantCommercePay.runAfterAuth(this, amount)) {
      com.haroldndougou.blyp.shell.BlypShellInstantCommercePay.Outcome.Started -> {
        val left = com.haroldndougou.blyp.shell.BlypShellSession.profile(this)?.balanceFcfa ?: 0
        QuickPayNativeSecrets.updateBalance(this, left)
        com.haroldndougou.blyp.shell.BlypShellPayFeedback.markPaySuccess(amount)
        com.haroldndougou.blyp.shell.BlypShellUiRefresh.notifyWalletChanged()
        toast(getString(R.string.quick_pay_success))
        QuickPayNotifService.clearHighlight(this)
        leaveWithoutApp()
        return
      }
      com.haroldndougou.blyp.shell.BlypShellInstantCommercePay.Outcome.Denied -> {
        QuickPayNotifService.clearHighlight(this)
        leaveWithoutApp()
        return
      }
      com.haroldndougou.blyp.shell.BlypShellInstantCommercePay.Outcome.NotCommerce -> Unit
    }
    if (!com.haroldndougou.blyp.shell.BlypShellPayDossierStore.isBalanceSufficientForPay(this, amount)) {
      toast(getString(R.string.quick_pay_insufficient))
      QuickPayNotifService.clearHighlight(this)
      leaveWithoutApp()
      return
    }
    val snap = com.haroldndougou.blyp.shell.BlypShellPayRuntime.read(this) ?: run {
      toast(getString(R.string.quick_pay_not_ready))
      QuickPayNotifService.clearHighlight(this)
      leaveWithoutApp()
      return
    }
    val prevBal =
      com.haroldndougou.blyp.shell.BlypShellPayDossierStore.readVerified(this)?.balanceFcfa
        ?: snap.balanceFcfa
    val idem = java.util.UUID.randomUUID().toString()
    com.haroldndougou.blyp.shell.BlypShellPayRuntime.updateBalance(this, prevBal - amount)
    QuickPayNativeSecrets.updateBalance(this, (prevBal - amount).coerceAtLeast(0))
    com.haroldndougou.blyp.shell.BlypShellPayFeedback.markPaySuccess(amount)
    com.haroldndougou.blyp.shell.BlypShellUiRefresh.notifyWalletChanged()
    toast(getString(R.string.quick_pay_success))
    QuickPayNotifService.clearHighlight(this)
    leaveWithoutApp()
    com.haroldndougou.blyp.shell.BlypShellPayExecutor.payAsync(applicationContext, amount, { pay ->
      when {
        pay.ok ->
          QuickPayNotifBridge.emitPayCompleted(
            applicationContext,
            amount,
            pay.balanceFcfa,
            pay.transactionId,
          )
        pay.message == "insufficient_balance" ||
          pay.message == "no_recipient" ||
          pay.message == "not_configured" -> {
          com.haroldndougou.blyp.shell.BlypShellPayRuntime.updateBalance(applicationContext, prevBal)
          QuickPayNativeSecrets.updateBalance(applicationContext, prevBal)
          com.haroldndougou.blyp.shell.BlypShellUiRefresh.notifyWalletChanged()
        }
        com.haroldndougou.blyp.shell.BlypShellNetwork.isRetryablePayFailure(pay.message) -> {
          com.haroldndougou.blyp.shell.BlypShellOfflinePayQueue.enqueue(
            applicationContext,
            amount,
            idem,
            snap.recipientJson,
          )
          com.haroldndougou.blyp.shell.BlypShellOfflinePayQueue.flush(applicationContext)
        }
        else -> {
          com.haroldndougou.blyp.shell.BlypShellPayRuntime.updateBalance(applicationContext, prevBal)
          QuickPayNativeSecrets.updateBalance(applicationContext, prevBal)
          com.haroldndougou.blyp.shell.BlypShellUiRefresh.notifyWalletChanged()
        }
      }
    }, idem)
  }

  /** La notif et Payer paient la même personne. */
  private fun ensureSharedRecipient() {
    if (com.haroldndougou.blyp.shell.BlypShellPayRuntime.activeRecipientAccountId(this) != null) return
    val ready = QuickPayNativeSecrets.read(this) ?: return
    val raw = org.json.JSONObject(ready.recipientJson)
    val id = raw.optString("accountId", "").trim()
    val name = raw.optString("name", "").trim()
    if (id.isEmpty() || name.isEmpty()) return
    val phone = raw.optString("phoneDigits", "").replace(Regex("\\D"), "").takeLast(9)
    com.haroldndougou.blyp.shell.BlypShellPayRuntime.applyRecipient(
      this,
      com.haroldndougou.blyp.shell.BlypShellPayRuntime.RecipientOption(
        accountId = id,
        name = name,
        phoneDigits = phone.ifEmpty { null },
        fromBle = true,
      ),
    )
  }

  private fun leaveWithoutApp() {
    finishAndRemoveTask()
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
