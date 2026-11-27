package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

class ShellChatMoneyReceiptActivity : AppCompatActivity() {
  private var stamp: ShellCommerceStamp? = null
  private var stampMode = false
  private var signed = false
  private var busy = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val transferId = intent.getStringExtra(EXTRA_TRANSFER_ID)?.trim().orEmpty()
    val conversationId = intent.getStringExtra(EXTRA_CONVERSATION_ID)?.trim().orEmpty()
    val amount = intent.getIntExtra(EXTRA_AMOUNT, 0)
    if (transferId.isEmpty() || conversationId.isEmpty() || amount <= 0) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_chat_money_receipt)
    applySystemBarAppearance()
    val peer = intent.getStringExtra(EXTRA_PEER_NAME)?.trim().orEmpty()
    findViewById<View>(R.id.blyp_money_receipt_back).setOnClickListener { finish() }
    findViewById<TextView>(R.id.blyp_money_receipt_lead).text =
      getString(R.string.blyp_shell_money_receipt_claim_lead)
    findViewById<EditText>(R.id.blyp_money_receipt_client).setText(peer)
    val amountTxt =
      NumberFormat.getInstance(Locale.FRANCE).format(amount) + " F"
    findViewById<TextView>(R.id.blyp_money_receipt_amount).text = amountTxt

    val stampPanel = findViewById<LinearLayout>(R.id.blyp_money_receipt_stamp_panel)
    val claimPanel = findViewById<LinearLayout>(R.id.blyp_money_receipt_claim_panel)
    val stampEdit = findViewById<TextView>(R.id.blyp_money_receipt_stamp_edit)
    val title = findViewById<TextView>(R.id.blyp_money_receipt_title)
    val sig = findViewById<ShellMoneyReceiptSignatureView>(R.id.blyp_money_receipt_signature)
    val submit = findViewById<TextView>(R.id.blyp_money_receipt_submit)

    fun refreshTitle() {
      title.text =
        if (stampMode) {
          getString(R.string.blyp_shell_money_receipt_stamp_title)
        } else {
          getString(R.string.blyp_shell_money_receipt_claim_title)
        }
    }

    fun showStampMode(on: Boolean) {
      stampMode = on
      stampPanel.visibility = if (on) View.VISIBLE else View.GONE
      claimPanel.visibility = if (on) View.GONE else View.VISIBLE
      stampEdit.visibility = if (!on && stamp != null) View.VISIBLE else View.GONE
      refreshTitle()
    }

    fun refreshSubmit() {
      val ok =
        !busy &&
          stamp != null &&
          findViewById<EditText>(R.id.blyp_money_receipt_client).text.toString().trim()
            .isNotEmpty() &&
          findViewById<EditText>(R.id.blyp_money_receipt_reason).text.toString().trim()
            .isNotEmpty() &&
          signed
      submit.isEnabled = ok
      submit.alpha = if (ok) 1f else 0.5f
    }

    sig.onSignedChange = {
      signed = it
      refreshSubmit()
    }
    findViewById<TextView>(R.id.blyp_money_receipt_sig_clear).setOnClickListener { sig.clear() }
    val onField =
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}

        override fun afterTextChanged(s: Editable?) {
          refreshSubmit()
        }
      }
    findViewById<EditText>(R.id.blyp_money_receipt_client).addTextChangedListener(onField)
    findViewById<EditText>(R.id.blyp_money_receipt_reason).addTextChangedListener(onField)

    stampEdit.setOnClickListener { showStampMode(true) }
    findViewById<TextView>(R.id.blyp_money_receipt_stamp_save).setOnClickListener {
      val userId = BlypShellSession.accountId(this)?.trim().orEmpty()
      if (userId.isEmpty()) return@setOnClickListener
      val line1 = findViewById<EditText>(R.id.blyp_money_receipt_stamp_line1).text.toString()
      val line2 = findViewById<EditText>(R.id.blyp_money_receipt_stamp_line2).text.toString()
      when (
        val res =
          BlypShellCommerceStampStore.save(
            this,
            userId,
            BlypShellCommerceSession.activeCommerceId(this),
            line1,
            line2,
            "circle",
            "red",
          )
      ) {
        is BlypShellCommerceStampStore.SaveResult.Ok -> {
          stamp = res.stamp
          showStampMode(false)
          refreshSubmit()
        }
        BlypShellCommerceStampStore.SaveResult.Duplicate ->
          toast(getString(R.string.blyp_shell_money_receipt_stamp_dup))
        BlypShellCommerceStampStore.SaveResult.Invalid -> {
          /* ignore */
        }
      }
    }

    submit.setOnClickListener {
      val s = stamp ?: return@setOnClickListener
      val client =
        findViewById<EditText>(R.id.blyp_money_receipt_client).text.toString().trim()
      val reason =
        findViewById<EditText>(R.id.blyp_money_receipt_reason).text.toString().trim()
      if (client.isEmpty() || reason.isEmpty() || !signed || busy) return@setOnClickListener
      val accountId = BlypShellSession.accountId(this)?.trim().orEmpty()
      if (accountId.isEmpty()) return@setOnClickListener
      busy = true
      refreshSubmit()
      Thread {
          val draft =
            BlypShellMoneyReceiptPdf.Draft(
              transferId = transferId,
              amountFcfa = amount,
              clientName = client,
              reason = reason,
              stamp = s,
            )
          val pdf = BlypShellMoneyReceiptPdf.generate(this, draft)
          if (pdf == null) {
            runOnUiThread {
              busy = false
              refreshSubmit()
              toast(getString(R.string.blyp_shell_money_receipt_failed))
            }
            return@Thread
          }
          if (!BlypMerchantReceiptStore.hasBlypMoney(this, accountId, transferId)) {
            val name = BlypShellMoneyReceiptPdf.receiptDisplayName(this, amount, client)
            BlypMerchantReceiptStore.addBlypMoney(
              this,
              accountId,
              transferId,
              name,
              s.line1,
              pdf,
            )
          }
          BlypShellChatMoneyClaim.claimAsync(this, transferId, "claim") { ok, transfer, balance ->
            runOnUiThread {
              busy = false
              if (!ok || transfer == null) {
                refreshSubmit()
                toast(getString(R.string.blyp_shell_chat_money_action_failed))
                return@runOnUiThread
              }
              balance?.let { BlypShellSession.updateBalance(this, it) }
              BlypShellChatMessagesStore.patchMoneyTransferById(
                this,
                BlypShellSession.phone(this).orEmpty(),
                conversationId,
                transferId,
                transfer,
              )
              setResult(
                RESULT_OK,
                android.content.Intent().putExtra(EXTRA_TRANSFER_ID, transferId),
              )
              finish()
            }
          }
        }
        .start()
    }

    val userId = BlypShellSession.accountId(this)?.trim().orEmpty()
    Thread {
        val loaded =
          if (userId.isEmpty()) {
            null
          } else {
            BlypShellCommerceStampStore.load(
              this,
              userId,
              BlypShellCommerceSession.activeCommerceId(this),
            )
          }
        runOnUiThread {
          stamp = loaded
          if (stamp == null) {
            showStampMode(true)
          } else {
            showStampMode(false)
          }
          refreshSubmit()
        }
      }
      .start()
  }

  private fun toast(msg: String) {
    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
  }

  private fun applySystemBarAppearance() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  companion object {
    const val EXTRA_TRANSFER_ID = "blyp_money_receipt_transfer"
    const val EXTRA_CONVERSATION_ID = "blyp_money_receipt_conv"
    const val EXTRA_AMOUNT = "blyp_money_receipt_amount"
    const val EXTRA_PEER_NAME = "blyp_money_receipt_peer"

    fun start(
      context: Context,
      conversationId: String,
      transferId: String,
      amountFcfa: Int,
      peerName: String?,
    ) {
      context.startActivity(
        Intent(context, ShellChatMoneyReceiptActivity::class.java).apply {
          putExtra(EXTRA_CONVERSATION_ID, conversationId.trim())
          putExtra(EXTRA_TRANSFER_ID, transferId.trim())
          putExtra(EXTRA_AMOUNT, amountFcfa)
          peerName?.trim()?.takeIf { it.isNotEmpty() }?.let { putExtra(EXTRA_PEER_NAME, it) }
        },
      )
    }

    fun buildIntent(
      context: Context,
      conversationId: String,
      transferId: String,
      amountFcfa: Int,
      peerName: String?,
    ): Intent =
      Intent(context, ShellChatMoneyReceiptActivity::class.java).apply {
        putExtra(EXTRA_CONVERSATION_ID, conversationId.trim())
        putExtra(EXTRA_TRANSFER_ID, transferId.trim())
        putExtra(EXTRA_AMOUNT, amountFcfa)
        peerName?.trim()?.takeIf { it.isNotEmpty() }?.let { putExtra(EXTRA_PEER_NAME, it) }
      }
  }
}