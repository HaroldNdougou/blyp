package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.SpannableString
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R

/** Rechargement wallet natif — sans îlot React. */
class ShellDepositActivity : AppCompatActivity() {
  private var busy = false
  private var withdrawMode = false
  private var formattingAmount = false
  private var pendingDepositAmount = 0

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    withdrawMode = intent.getBooleanExtra(EXTRA_WITHDRAW, false)
    setContentView(R.layout.blyp_shell_deposit)
    applySystemBarAppearance()
    findViewById<View>(R.id.blyp_deposit_close).setOnClickListener { finish() }
    val amountInput = findViewById<EditText>(R.id.blyp_deposit_amount)
    wireAmount(amountInput, findViewById(R.id.blyp_deposit_clear))
    if (withdrawMode) {
      findViewById<TextView>(R.id.blyp_deposit_title).setText(R.string.blyp_shell_profile_withdraw_title)
      findViewById<TextView>(R.id.blyp_deposit_hint).setText(R.string.blyp_shell_withdraw_hint)
      findViewById<TextView>(R.id.blyp_deposit_submit).setText(R.string.blyp_shell_profile_action_withdraw)
      val all = findViewById<TextView>(R.id.blyp_deposit_all)
      all.visibility = View.VISIBLE
      all.setOnClickListener {
        val bal = BlypShellSession.profile(this)?.balanceFcfa ?: 0
        amountInput.setText(if (bal > 0) bal.toString() else "")
      }
    }
    bindQuick(R.id.blyp_deposit_q500, 500, amountInput)
    bindQuick(R.id.blyp_deposit_q1000, 1000, amountInput)
    bindQuick(R.id.blyp_deposit_q2000, 2000, amountInput)
    bindQuick(R.id.blyp_deposit_q5000, 5000, amountInput)
    findViewById<TextView>(R.id.blyp_deposit_submit).setOnClickListener {
      submit(amountInput)
    }
  }

  private fun wireAmount(input: EditText, clear: View) {
    clear.setOnClickListener { input.setText("") }
    input.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(s: Editable?) {
        if (formattingAmount) return
        val raw = s?.toString().orEmpty()
        val digitsOnly = raw.filter { it.isDigit() }.take(7)
        val cleaned = digitsOnly.trimStart('0').ifEmpty { if (digitsOnly.isEmpty()) "" else "0" }
        val shown = groupAmount(cleaned)
        if (shown != raw) {
          formattingAmount = true
          val cursorDigits = raw.take(input.selectionStart.coerceAtLeast(0)).count { it.isDigit() }
          input.setText(shown)
          input.setSelection(indexAfterDigits(shown, cursorDigits).coerceIn(0, shown.length))
          formattingAmount = false
        }
        clear.visibility = if (shown.isEmpty()) View.GONE else View.VISIBLE
      }
    })
  }

  private fun groupAmount(digits: String): String {
    if (digits.isEmpty()) return ""
    return digits.reversed().chunked(3).joinToString(" ").reversed()
  }

  private fun indexAfterDigits(shown: String, digits: Int): Int {
    if (digits <= 0) return 0
    var seen = 0
    shown.forEachIndexed { index, char ->
      if (char.isDigit()) {
        seen += 1
        if (seen == digits) return index + 1
      }
    }
    return shown.length
  }

  private fun bindQuick(viewId: Int, amount: Int, input: EditText) {
    val locale = if (java.util.Locale.getDefault().language == "fr") java.util.Locale.FRENCH else java.util.Locale.US
    val number = java.text.NumberFormat.getIntegerInstance(locale).format(amount)
    findViewById<TextView>(viewId).apply {
      text = PayOverlayUi.chipLabel(number)
      setOnClickListener { input.setText(amount.toString()) }
    }
  }

  private fun submit(input: EditText) {
    if (busy) return
    val amount = input.text.toString().replace(Regex("\\D"), "").toIntOrNull() ?: 0
    if (amount <= 0) {
      toast(getString(R.string.blyp_shell_deposit_invalid))
      return
    }
    if (withdrawMode) {
      val balance = BlypShellSession.profile(this)?.balanceFcfa ?: 0
      if (amount > balance) {
        toast(getString(R.string.blyp_shell_withdraw_insufficient))
        return
      }
      BlypShellMoneyRequests.record(this, "withdrawal", amount)
      val phone = formatPhone(BlypShellSession.phone(this).orEmpty())
      val shown = groupAmount(amount.toString()) + " FCFA"
      BlypShellDialogs.alertBuilder(this)
        .setTitle(R.string.blyp_shell_profile_withdraw_title)
        .setMessage(withdrawMessage(shown, phone))
        .setPositiveButton(android.R.string.ok) { _, _ -> input.setText("") }
        .show()
      return
    }
    pendingDepositAmount = amount
    BlypShellMoneyRequests.record(this, "deposit", amount)
    val shown = groupAmount(amount.toString()) + " FCFA"
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_deposit_title)
      .setMessage(depositMessage(shown))
      .setPositiveButton(R.string.blyp_shell_deposit_call) { _, _ -> placeDepositCall() }
      .show()
  }

  private fun withdrawMessage(amount: String, phone: String): CharSequence {
    val full = getString(R.string.blyp_shell_withdraw_approved, amount, phone)
    val span = SpannableString(full)
    emphasize(span, full, amount)
    emphasize(span, full, phone)
    return span
  }

  private fun depositMessage(amount: String): CharSequence {
    val phone = if (isOrange(BlypShellSession.phone(this).orEmpty())) "698 25 68 96" else "674 63 08 17"
    val name = "Harold Etienne Bossogueno Ndougou"
    val full = getString(R.string.blyp_shell_deposit_transfer, amount, phone, name)
    val span = SpannableString(full)
    emphasize(span, full, amount)
    emphasize(span, full, phone)
    emphasize(span, full, name)
    return span
  }

  private fun emphasize(span: SpannableString, full: String, part: String) {
    val start = full.indexOf(part)
    if (start < 0) return
    val end = start + part.length
    span.setSpan(StyleSpan(Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    span.setSpan(
      ForegroundColorSpan(ContextCompat.getColor(this, R.color.blyp_shell_accent)),
      start,
      end,
      Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
  }

  private fun placeDepositCall() {
    startDepositCall()
  }

  private fun isOrange(raw: String): Boolean {
    var d = raw.filter { it.isDigit() }
    if (d.startsWith("237") && d.length >= 12) d = d.substring(3)
    if (d.length > 9) d = d.takeLast(9)
    if (d.length < 3 || d[0] != '6') return false
    if (d.startsWith("69") || d.startsWith("640") || d.startsWith("686")) return true
    if (d.startsWith("65")) {
      val third = d[2] - '0'
      if (third in 5..9) return true
    }
    return false
  }

  private fun startDepositCall() {
    val orange = isOrange(BlypShellSession.phone(this).orEmpty())
    val code = if (orange) {
      "#150*11*698256896*$pendingDepositAmount#"
    } else {
      "*126*11*674630817*$pendingDepositAmount#"
    }
    val uri = Uri.parse("tel:" + code.replace("#", "%23"))
    try {
      startActivity(Intent(Intent.ACTION_DIAL, uri))
    } catch (_: Exception) {
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

  private fun formatPhone(digits: String): String {
    val d = digits.replace(Regex("\\D"), "")
    if (d.length == 9) return "+237 ${d.substring(0, 3)} ${d.substring(3, 6)} ${d.substring(6)}"
    return if (d.startsWith("237") && d.length >= 12) "+$d" else d.ifEmpty { getString(R.string.blyp_shell_profile_dash) }
  }

  companion object {
    private const val EXTRA_WITHDRAW = "withdraw"

    fun startWithdraw(context: Context) {
      context.startActivity(
        Intent(context, ShellDepositActivity::class.java).apply {
          putExtra(EXTRA_WITHDRAW, true)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }

    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellDepositActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}
