package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R
import java.util.UUID

class ShellChatMoneyActivity : AppCompatActivity() {
  private var busy = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val convId = intent.getStringExtra(EXTRA_CONVERSATION_ID)?.trim().orEmpty()
    if (convId.isEmpty()) {
      finish()
      return
    }
    window.setSoftInputMode(
      WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
    )
    setContentView(R.layout.blyp_shell_chat_money)
    applySystemBarAppearance()
    findViewById<android.view.View>(R.id.blyp_chat_money_back).setOnClickListener { finish() }
    val input = findViewById<EditText>(R.id.blyp_chat_money_amount)
    findViewById<EditText>(R.id.blyp_chat_money_motif)?.let { BlypShellPayMotif.bind(it) }
    bindMotifChips(convId)
    val preset = intent.getIntExtra(EXTRA_AMOUNT, 0)
    if (preset > 0) input.setText(preset.toString())
    if (preset <= 0) {
      input.requestFocus()
      input.post {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        input.postDelayed({
          if (isDestroyed || busy) return@postDelayed
          input.requestFocus()
          imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }, 180)
      }
    }
    bindQuick(R.id.blyp_chat_money_q500, 500, input)
    bindQuick(R.id.blyp_chat_money_q1000, 1000, input)
    bindQuick(R.id.blyp_chat_money_q2000, 2000, input)
    bindQuick(R.id.blyp_chat_money_q5000, 5000, input)
    findViewById<TextView>(R.id.blyp_chat_money_send).setOnClickListener {
      submit(convId, input)
    }
    if (preset > 0 && savedInstanceState == null) {
      input.post {
        if (!isFinishing && !busy) submit(convId, input)
      }
    }
  }

  private fun readMotif(): String? =
    BlypShellPayMotif.sanitize(findViewById<EditText>(R.id.blyp_chat_money_motif)?.text)

  private fun bindMotifChips(conversationId: String) {
    val row = findViewById<LinearLayout>(R.id.blyp_chat_money_motif_chips) ?: return
    val field = findViewById<EditText>(R.id.blyp_chat_money_motif) ?: return
    row.removeAllViews()
    val d = resources.displayMetrics.density
    val gap = (8 * d).toInt()
    for (label in BlypShellMotifSuggestions.ranked(this, conversationId)) {
      val chip =
        TextView(this).apply {
          text = label
          gravity = Gravity.CENTER
          setTextColor(ContextCompat.getColor(this@ShellChatMoneyActivity, R.color.blyp_shell_text))
          textSize = 13f
          setPadding((14 * d).toInt(), (8 * d).toInt(), (14 * d).toInt(), (8 * d).toInt())
          setBackgroundResource(R.drawable.blyp_shell_filter_chip)
          setOnClickListener {
            field.setText(label)
            field.setSelection(field.text?.length ?: 0)
          }
        }
      val lp =
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        )
      if (row.childCount > 0) lp.marginStart = gap
      row.addView(chip, lp)
    }
  }

  private fun bindQuick(viewId: Int, amount: Int, input: EditText) {
    val locale = if (java.util.Locale.getDefault().language == "fr") java.util.Locale.FRENCH else java.util.Locale.US
    val number = java.text.NumberFormat.getIntegerInstance(locale).format(amount)
    findViewById<TextView>(viewId).apply {
      text = PayOverlayUi.chipLabel(number)
      setOnClickListener { input.setText(amount.toString()) }
    }
  }

  private fun submit(conversationId: String, input: EditText) {
    if (busy) return
    val amount = input.text.toString().replace(Regex("\\D"), "").toIntOrNull() ?: 0
    if (amount <= 0) {
      toast(getString(R.string.blyp_shell_chat_money_invalid))
      return
    }
    if (!BlypShellNetwork.isOnline(this)) {
      showOfflinePill()
      return
    }
    val motif = readMotif()
    if (fingerReady()) {
      askFinger(amount, conversationId, motif, dialog = null, pinView = null, alreadySent = { false }, markSent = {}, onRejected = {})
      return
    }
    showPinDialog(conversationId, amount, motif)
  }

  private fun showPinDialog(conversationId: String, amount: Int, motif: String?) {
    var sent = false
    lateinit var dialog: android.app.Dialog
    lateinit var pinView: EditText
    val pinBox =
      blypMaskedPin(this) { pin ->
          if (sent || busy) return@blypMaskedPin
          sent = true
          sendMoney(conversationId, amount, pin, motif, dialog, pinView) { sent = false }
        }
        .also { pinView = it.second }
        .first
    val column =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        addView(pinBox)
      }
    dialog =
      BlypShellDialogs.alertBuilder(this)
        .setTitle(R.string.blyp_shell_chat_money_pin_title)
        .setView(column)
        .setNegativeButton(android.R.string.cancel, null)
        .create()
    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    dialog.setOnShowListener { showPinKeyboard(pinView) }
    dialog.show()
  }

  private fun fingerReady(): Boolean {
    val pin = BlypShellPayRuntime.readPinOnly(this)?.filter { it.isDigit() }.orEmpty()
    if (pin.length != 4) return false
    return try {
      BiometricManager.from(this).canAuthenticate(fingerAuthenticators()) ==
        BiometricManager.BIOMETRIC_SUCCESS
    } catch (_: Exception) {
      false
    }
  }

  private fun fingerAuthenticators(): Int =
    BiometricManager.Authenticators.BIOMETRIC_STRONG or
      BiometricManager.Authenticators.BIOMETRIC_WEAK

  private fun askFinger(
    amount: Int,
    conversationId: String,
    motif: String?,
    dialog: android.app.Dialog?,
    pinView: EditText?,
    alreadySent: () -> Boolean,
    markSent: () -> Unit,
    onRejected: () -> Unit,
  ) {
    if (alreadySent() || busy || isFinishing) return
    pinView?.let {
      val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
      imm.hideSoftInputFromWindow(it.windowToken, 0)
    }
    var used = false
    val prompt =
      BiometricPrompt(
        this,
        ContextCompat.getMainExecutor(this),
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (busy || used) return
            val cancel =
              errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                errorCode == BiometricPrompt.ERROR_CANCELED
            if (cancel) return
            if (dialog == null) showPinDialog(conversationId, amount, motif)
            else if (pinView != null) showPinKeyboard(pinView)
          }

          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            if (alreadySent() || busy || used) return
            if (dialog != null && dialog.isShowing != true) return
            val pin =
              BlypShellPayRuntime.readPinOnly(this@ShellChatMoneyActivity)
                ?.filter { it.isDigit() }
                .orEmpty()
            if (pin.length != 4) {
              toast(getString(R.string.blyp_shell_chat_money_failed))
              if (dialog == null) showPinDialog(conversationId, amount, motif)
              else if (pinView != null) showPinKeyboard(pinView)
              return
            }
            used = true
            markSent()
            sendMoney(conversationId, amount, pin, motif, dialog, pinView, onRejected)
          }
        },
      )
    val info =
      BiometricPrompt.PromptInfo.Builder()
        .setTitle(getString(R.string.blyp_shell_chat_money_bio_title))
        .setSubtitle(getString(R.string.blyp_shell_chat_money_bio_subtitle, amount))
        .setAllowedAuthenticators(fingerAuthenticators())
        .setNegativeButtonText(getString(android.R.string.cancel))
        .build()
    try {
      prompt.authenticate(info)
    } catch (_: Exception) {
      if (dialog == null) showPinDialog(conversationId, amount, motif)
      else if (pinView != null) showPinKeyboard(pinView)
    }
  }

  private fun showPinKeyboard(pinView: EditText) {
    pinView.isEnabled = true
    pinView.requestFocus()
    pinView.post {
      val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
      imm.showSoftInput(pinView, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  private fun sendMoney(
    conversationId: String,
    amount: Int,
    pin: String,
    motif: String?,
    dialog: android.app.Dialog?,
    pinView: EditText?,
    onRejected: () -> Unit,
  ) {
    val clientId = UUID.randomUUID().toString()
    val idem = UUID.randomUUID().toString()
    busy = true
    pinView?.isEnabled = false
    val sendBtn =
      dialog?.findViewById<TextView>(R.id.blyp_dialog_title)
        ?: findViewById<TextView>(R.id.blyp_chat_money_send)
    BlypButtonSpinner.show(sendBtn)
    BlypShellChatMediaSend.sendMoneyAsync(
      this,
      conversationId,
      amount,
      clientId,
      idem,
      pin,
      motif,
      null,
    ) { ok, msg, balance, pinWrong, _ ->
      busy = false
      BlypButtonSpinner.hide(sendBtn)
      if (!ok || msg == null) {
        toast(
          getString(
            if (pinWrong) R.string.blyp_shell_chat_money_pin_wrong
            else R.string.blyp_shell_chat_money_failed,
          ),
        )
        if (dialog?.isShowing == true && pinView != null) {
          onRejected()
          pinView.isEnabled = true
          pinView.setText("")
          pinView.requestFocus()
          val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
          imm.showSoftInput(pinView, InputMethodManager.SHOW_IMPLICIT)
        }
        return@sendMoneyAsync
      }
      dialog?.dismiss()
      val phone = BlypShellSession.phone(this).orEmpty()
      val local = BlypShellChatMessagesStore.loadRawObjects(this, phone, conversationId)
      val merged = BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(msg))
      BlypShellChatMessagesStore.saveMerged(this, phone, conversationId, merged)
      balance?.let { BlypShellSession.updateBalance(this, it) }
      val peer =
        BlypShellChatMessagesStore.conversationMeta(this, phone, conversationId)
          ?.optString("peerName")
          ?.trim()
          .orEmpty()
      val transferId =
        msg.optJSONObject("moneyTransfer")?.optString("transferId").orEmpty()
          .ifEmpty { msg.optString("id") }
      BlypTransactionStore.insertMessageMoney(
        this,
        phone,
        transferId.ifEmpty { clientId },
        amount,
        peer.ifEmpty { "Message Money" },
        motif,
      )
      if (!motif.isNullOrBlank()) {
        BlypShellMotifSuggestions.noteUsed(this, conversationId, motif)
      }
      BlypShellUiRefresh.notifyWalletChanged()
      setResult(RESULT_OK)
      finish()
    }
  }

  private fun applySystemBarAppearance() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, true)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  private fun showOfflinePill() {
    val root = findViewById<android.widget.FrameLayout>(android.R.id.content)
    root.findViewWithTag<android.view.View>("blyp_money_offline")?.let { root.removeView(it) }
    val d = resources.displayMetrics.density
    val pill =
      android.widget.LinearLayout(this).apply {
        tag = "blyp_money_offline"
        orientation = android.widget.LinearLayout.HORIZONTAL
        gravity = android.view.Gravity.CENTER_VERTICAL
        val pad = (14 * d).toInt()
        setPadding(pad, (10 * d).toInt(), (16 * d).toInt(), (10 * d).toInt())
        background =
          android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = 28 * d
            setColor(ContextCompat.getColor(this@ShellChatMoneyActivity, R.color.blyp_shell_modal))
          }
        elevation = 8 * d
      }
    val logo =
      android.widget.ImageView(this).apply {
        setImageResource(R.mipmap.ic_launcher)
        val size = (36 * d).toInt()
        layoutParams = android.widget.LinearLayout.LayoutParams(size, size)
      }
    val label =
      TextView(this).apply {
        text = getString(R.string.blyp_shell_chat_money_offline)
        setTextColor(ContextCompat.getColor(this@ShellChatMoneyActivity, R.color.blyp_shell_text))
        textSize = 14f
        val start = (10 * d).toInt()
        setPadding(start, 0, 0, 0)
      }
    pill.addView(logo)
    pill.addView(label)
    val lp =
      android.widget.FrameLayout.LayoutParams(
        android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
        android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
        android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL,
      )
    val side = (20 * d).toInt()
    lp.setMargins(side, 0, side, (28 * d).toInt())
    root.addView(pill, lp)
    pill.postDelayed(
      {
        if (pill.parent === root) root.removeView(pill)
      },
      3400,
    )
  }

  companion object {
    const val EXTRA_CONVERSATION_ID = "blyp_shell_chat_money_conv"
    const val EXTRA_AMOUNT = "blyp_shell_chat_money_amount"

    fun start(context: Context, conversationId: String) {
      context.startActivity(
        Intent(context, ShellChatMoneyActivity::class.java).apply {
          putExtra(EXTRA_CONVERSATION_ID, conversationId.trim())
        },
      )
    }
  }
}
