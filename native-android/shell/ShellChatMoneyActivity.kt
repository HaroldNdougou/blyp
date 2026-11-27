package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
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
    val pinView =
      EditText(this).apply {
        inputType =
          android.text.InputType.TYPE_CLASS_NUMBER or
            android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        filters =
          arrayOf(
            android.text.InputFilter.LengthFilter(4),
            android.text.InputFilter { source, start, end, _, _, _ ->
              for (i in start until end) {
                if (!source[i].isDigit()) return@InputFilter ""
              }
              null
            },
          )
        maxLines = 1
        setSingleLine(true)
        requestFocus()
      }
    val dialog =
      BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_chat_money_pin_title)
      .setView(pinView)
      .setNegativeButton(android.R.string.cancel, null)
      .setPositiveButton(R.string.blyp_shell_chat_send) { _, _ ->
        val pin = pinView.text.toString().trim()
        if (pin.length != 4) {
          toast(getString(R.string.blyp_shell_chat_money_pin_wrong))
          return@setPositiveButton
        }
        val clientId = UUID.randomUUID().toString()
        val idem = UUID.randomUUID().toString()
        busy = true
        BlypButtonSpinner.show(findViewById(R.id.blyp_chat_money_send))
        BlypShellChatMediaSend.sendMoneyAsync(
          this,
          conversationId,
          amount,
          clientId,
          idem,
          pin,
          null,
          null,
        ) { ok, msg, balance, pinWrong, _ ->
          busy = false
          BlypButtonSpinner.hide(findViewById(R.id.blyp_chat_money_send))
          if (!ok || msg == null) {
            toast(
              getString(
                if (pinWrong) R.string.blyp_shell_chat_money_pin_wrong
                else R.string.blyp_shell_chat_money_failed,
              ),
            )
            return@sendMoneyAsync
          }
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
          val transferId = msg.optJSONObject("moneyTransfer")?.optString("transferId").orEmpty()
            .ifEmpty { msg.optString("id") }
          BlypTransactionStore.insertMessageMoney(
            this,
            phone,
            transferId.ifEmpty { clientId },
            amount,
            peer.ifEmpty { "Message Money" },
          )
          BlypShellUiRefresh.notifyWalletChanged()
          setResult(RESULT_OK)
          finish()
        }
      }
      .create()
    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    dialog.setOnShowListener {
      pinView.requestFocus()
      pinView.post {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(pinView, InputMethodManager.SHOW_IMPLICIT)
      }
    }
    dialog.show()
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