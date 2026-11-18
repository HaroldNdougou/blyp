package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.ViewFlipper
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R

/** Connexion téléphone + OTP — sans îlot React. */
class ShellSignInActivity : AppCompatActivity() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var phoneDigits = ""
  private var busy = false
  private var resendSeconds = 0
  private var resendTick: Runnable? = null
  private lateinit var flipper: ViewFlipper
  private lateinit var resendView: TextView
  private lateinit var phoneBrand: ImageView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    BlypShellAuthMirror.ensureHydrated(this)
    if (BlypShellSession.hasValidSession(this) && !BlypShellSession.needsOnboarding(this)) {
      if (ShellPinBootstrapActivity.startIfNeeded(this)) {
        finish()
        return
      }
      openShell()
      return
    }
    if (BlypShellSession.hasValidSession(this) && BlypShellSession.needsOnboarding(this)) {
      ShellNativeOnboardingActivity.start(this)
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_sign_in)
    applySystemBarAppearance()
    flipper = findViewById(R.id.blyp_auth_flipper)
    resendView = findViewById(R.id.blyp_auth_otp_resend)
    val phoneInput = findViewById<EditText>(R.id.blyp_auth_phone)
    phoneBrand = findViewById(R.id.blyp_auth_phone_brand)
    attachPhoneMask(phoneInput)
    val otpInput = findViewById<EditText>(R.id.blyp_auth_otp)

    findViewById<TextView>(R.id.blyp_auth_phone_continue).setOnClickListener {
      submitPhone(phoneInput)
    }
    findViewById<View>(R.id.blyp_auth_otp_back).setOnClickListener { showPhoneStep() }
    findViewById<TextView>(R.id.blyp_auth_otp_edit_phone).setOnClickListener { showPhoneStep() }
    findViewById<TextView>(R.id.blyp_auth_otp_verify).setOnClickListener {
      submitOtp(otpInput, false)
    }
    resendView.setOnClickListener {
      if (resendSeconds > 0 || busy) return@setOnClickListener
      requestOtp(showOtpStep = false)
    }

    BlypDigitLines(findViewById<LinearLayout>(R.id.blyp_auth_otp_cells), otpInput, OTP_LEN, masked = false)
    otpInput.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          val d = s?.toString()?.replace(Regex("\\D"), "").orEmpty()
          if (d.length == OTP_LEN && !busy) submitOtp(otpInput, false)
        }
      },
    )
  }

  override fun onDestroy() {
    resendTick?.let { mainHandler.removeCallbacks(it) }
    super.onDestroy()
  }

  override fun onResume() {
    super.onResume()
    BlypShellAuthMirror.ensureHydrated(this)
    if (BlypShellSession.hasValidSession(this) && !BlypShellSession.needsOnboarding(this)) {
      openShell()
    }
  }

  private fun showPhoneStep() {
    flipper.displayedChild = 0
    resendTick?.let { mainHandler.removeCallbacks(it) }
    resendSeconds = 0
    updateResendLabel()
  }

  private fun showOtpStep() {
    flipper.displayedChild = 1
    findViewById<EditText>(R.id.blyp_auth_otp).setText("")
  }

  /** 9 chiffres, espace après les 3 premiers puis tous les 2 : « 698 25 68 96 ». */
  private fun attachPhoneMask(input: EditText) {
    input.addTextChangedListener(
      object : TextWatcher {
        private var editing = false

        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}

        override fun afterTextChanged(s: Editable?) {
          if (editing || s == null) return
          val cursor = input.selectionStart.coerceAtLeast(0)
          val digitsBefore = s.take(cursor.coerceAtMost(s.length)).count { it.isDigit() }
          val digits = s.toString().filter { it.isDigit() }.take(PHONE_DIGITS)
          val formatted = formatPhoneSpaced(digits)
          if (formatted != s.toString()) {
            editing = true
            s.replace(0, s.length, formatted)
            val pos = cursorAfterDigits(formatted, digitsBefore.coerceAtMost(digits.length))
            input.setSelection(pos.coerceIn(0, formatted.length))
            editing = false
          }
          bindWalletBrand(digits)
        }
      },
    )
  }

  /** Même préfixes que l’ancien écran : Orange ou MoMo, sinon rien. */
  private fun bindWalletBrand(digits: String) {
    val brand = walletBrand(digits)
    if (brand == null) {
      phoneBrand.visibility = View.GONE
      return
    }
    val orange = brand == "orange"
    phoneBrand.setImageResource(
      if (orange) R.drawable.blyp_shell_orange_money else R.drawable.blyp_shell_mtn_momo,
    )
    phoneBrand.contentDescription =
      getString(
        if (orange) R.string.blyp_shell_auth_brand_orange else R.string.blyp_shell_auth_brand_mtn,
      )
    val d = resources.displayMetrics.density
    val lp = phoneBrand.layoutParams
    lp.width = ((if (orange) 18 else 38) * d).toInt()
    lp.height = ((if (orange) 18 else 16) * d).toInt()
    phoneBrand.layoutParams = lp
    phoneBrand.visibility = View.VISIBLE
  }

  private fun walletBrand(raw: String): String? {
    val d = raw.filter { it.isDigit() }.take(PHONE_DIGITS)
    if (d.length < 2 || d[0] != '6') return null
    if (d.startsWith("69")) return "orange"
    if (d.startsWith("64")) {
      if (d.length < 3) return null
      if (d.startsWith("640")) return "orange"
    }
    if (d.startsWith("68")) {
      if (d.length < 3) return null
      if (d.startsWith("686")) return "orange"
      return "mtn"
    }
    if (d.startsWith("67")) return "mtn"
    if (d.startsWith("65")) {
      if (d.length < 3) return null
      val third = d[2] - '0'
      if (third in 0..4) return "mtn"
      if (third in 5..9) return "orange"
    }
    if (d.startsWith("66")) return null
    return null
  }

  private fun formatPhoneSpaced(digits: String): String {
    if (digits.isEmpty()) return ""
    val parts = ArrayList<String>(4)
    parts.add(digits.take(3))
    var i = 3
    while (i < digits.length) {
      parts.add(digits.substring(i, minOf(i + 2, digits.length)))
      i += 2
    }
    return parts.joinToString(" ")
  }

  private fun cursorAfterDigits(formatted: String, digitCount: Int): Int {
    if (digitCount <= 0) return 0
    var seen = 0
    for (i in formatted.indices) {
      if (formatted[i].isDigit()) {
        seen++
        if (seen == digitCount) return i + 1
      }
    }
    return formatted.length
  }

  private fun submitPhone(input: EditText) {
    if (busy) return
    if (!BlypShellConfig.hasApiForAuth(this)) {
      toast(getString(R.string.blyp_shell_auth_no_api))
      return
    }
    val digits = BlypShellAuthClient.normalizePhoneDigits(input.text.toString())
    if (digits == null) {
      toast(getString(R.string.blyp_shell_auth_phone_invalid))
      return
    }
    phoneDigits = digits
    requestOtp(showOtpStep = true)
  }

  private fun requestOtp(showOtpStep: Boolean) {
    if (busy || phoneDigits.isEmpty()) return
    busy = true
    setBusyUi(
      true,
      if (showOtpStep) R.id.blyp_auth_phone_continue else R.id.blyp_auth_otp_resend,
    )
    BlypShellAuthClient.requestOtpAsync(this, phoneDigits) { ok, _ ->
      runOnUiThread {
        busy = false
        setBusyUi(false)
        if (!ok) {
          toast(getString(R.string.blyp_shell_auth_send_failed))
          return@runOnUiThread
        }
        if (showOtpStep) showOtpStep()
        startResendCooldown()
        toast(getString(R.string.blyp_shell_auth_code_sent))
      }
    }
  }

  private fun submitOtp(input: EditText, confirmReplace: Boolean) {
    if (busy) return
    val code = input.text.toString().replace(Regex("\\D"), "")
    if (code.length != OTP_LEN) {
      toast(getString(R.string.blyp_shell_auth_otp_invalid))
      return
    }
    busy = true
    setBusyUi(true, R.id.blyp_auth_otp_verify)
    BlypShellAuthClient.verifyOtpAsync(this, phoneDigits, code, confirmReplace) { payload ->
      runOnUiThread {
        busy = false
        setBusyUi(false)
        if (payload.needsSessionReplaceConfirm) {
          confirmReplaceSession(input)
          return@runOnUiThread
        }
        if (payload.token.isNullOrEmpty() || payload.user == null) {
          input.setText("")
          toast(
            payload.errorMessage ?: getString(R.string.blyp_shell_auth_verify_failed),
          )
          return@runOnUiThread
        }
        if (payload.replacedPreviousSession) {
          toast(getString(R.string.blyp_shell_auth_replace_done))
        }
        afterVerified()
      }
    }
  }

  private fun confirmReplaceSession(input: EditText) {
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_auth_replace_title)
      .setMessage(R.string.blyp_shell_auth_replace_message)
      .setNegativeButton(R.string.blyp_shell_auth_cancel, null)
      .setPositiveButton(R.string.blyp_shell_auth_replace_confirm) { _, _ ->
        submitOtp(input, true)
      }
      .show()
  }

  private fun afterVerified() {
    if (BlypShellSession.needsOnboarding(this)) {
      ShellNativeOnboardingActivity.start(this)
      finish()
      return
    }
    if (ShellPinBootstrapActivity.startIfNeeded(this)) {
      finish()
      return
    }
    openShell()
  }

  private fun setBusyUi(on: Boolean, spinnerId: Int = 0) {
    val alpha = if (on) 0.55f else 1f
    findViewById<View>(R.id.blyp_auth_phone_continue).alpha = alpha
    findViewById<View>(R.id.blyp_auth_otp_verify).alpha = alpha
    if (on) {
      if (spinnerId != 0) BlypButtonSpinner.show(findViewById(spinnerId))
    } else {
      BlypButtonSpinner.hide(findViewById(R.id.blyp_auth_phone_continue))
      BlypButtonSpinner.hide(findViewById(R.id.blyp_auth_otp_verify))
      BlypButtonSpinner.hide(resendView)
    }
  }

  private fun startResendCooldown() {
    resendSeconds = RESEND_COOLDOWN_SEC
    updateResendLabel()
    resendTick?.let { mainHandler.removeCallbacks(it) }
    val tick =
      object : Runnable {
        override fun run() {
          resendSeconds--
          updateResendLabel()
          if (resendSeconds > 0) mainHandler.postDelayed(this, 1000L)
        }
      }
    resendTick = tick
    mainHandler.postDelayed(tick, 1000L)
  }

  private fun updateResendLabel() {
    resendView.text =
      if (resendSeconds > 0) {
        getString(R.string.blyp_shell_auth_resend_in, resendSeconds)
      } else {
        getString(R.string.blyp_shell_auth_resend)
      }
    resendView.alpha = if (resendSeconds > 0) 0.5f else 1f
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
    private const val OTP_LEN = 4
    private const val PHONE_DIGITS = 9
    private const val RESEND_COOLDOWN_SEC = 60

    fun startFresh(context: Context) {
      context.startActivity(
        Intent(context, ShellSignInActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        },
      )
    }
  }
}
