package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R

/** Choix destinataire Pay — récents, numéro Blyp (sans React). */
class ShellPickRecipientActivity : AppCompatActivity() {
  private var pendingPayAmount = 0
  private var busy = false
  private lateinit var adapter: RecipientPickAdapter

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    pendingPayAmount = intent.getIntExtra(EXTRA_PENDING_PAY_AMOUNT, 0).coerceAtLeast(0)
    setContentView(R.layout.blyp_shell_pick_recipient)
    applySystemBarAppearance()
    findViewById<View>(R.id.blyp_pick_recipient_back).setOnClickListener { finish() }
    val phoneInput = findViewById<EditText>(R.id.blyp_pick_recipient_phone)
    adapter = RecipientPickAdapter { onPick(it) }
    findViewById<RecyclerView>(R.id.blyp_pick_recipient_list).apply {
      layoutManager = LinearLayoutManager(this@ShellPickRecipientActivity)
      adapter = this@ShellPickRecipientActivity.adapter
    }
    findViewById<TextView>(R.id.blyp_pick_recipient_search).setOnClickListener {
      searchByPhone(phoneInput)
    }
    reloadList()
  }

  private fun reloadList() {
    val rows = BlypShellPayRecipient.listForPicker(this)
    adapter.submit(rows)
    val empty = findViewById<TextView>(R.id.blyp_pick_recipient_empty)
    empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
  }

  private fun searchByPhone(input: EditText) {
    if (busy) return
    busy = true
    findViewById<TextView>(R.id.blyp_pick_recipient_search).alpha = 0.55f
    BlypButtonSpinner.show(findViewById(R.id.blyp_pick_recipient_search))
    BlypShellPayRecipient.resolvePhoneAsync(this, input.text.toString()) { result ->
      runOnUiThread {
        busy = false
        findViewById<TextView>(R.id.blyp_pick_recipient_search).alpha = 1f
        BlypButtonSpinner.hide(findViewById(R.id.blyp_pick_recipient_search))
        when (result) {
          is BlypShellPayRecipient.Result.Ok -> onPick(result.option)
          BlypShellPayRecipient.Result.InvalidPhone ->
            toast(getString(R.string.blyp_shell_auth_phone_invalid))
          BlypShellPayRecipient.Result.NotOnBlyp ->
            toast(getString(R.string.blyp_shell_pick_recipient_not_blyp))
          BlypShellPayRecipient.Result.SelfPhone ->
            toast(getString(R.string.blyp_shell_pick_recipient_self))
        }
      }
    }
  }

  private fun onPick(option: BlypShellPayRuntime.RecipientOption) {
    BlypShellPayRuntime.applyRecipient(this, option)
    BlypShellUiRefresh.notifyWalletChanged()
    maybeContinuePay()
  }

  private fun maybeContinuePay() {
    val amount = pendingPayAmount
    if (amount > 0 && BlypShellPayRuntime.isReady(this)) {
      if (!BlypShellNetwork.isOnline(this)) {
        android.widget.Toast.makeText(this, R.string.blyp_shell_pay_no_internet, android.widget.Toast.LENGTH_LONG).show()
        finish()
        return
      }
      ShellPayAuthActivity.start(this, amount)
      PayShellState.clearDigits()
      finish()
      return
    }
    setResult(RESULT_OK)
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
    const val EXTRA_PENDING_PAY_AMOUNT = "pending_pay_amount"

    fun start(context: Context, pendingPayAmountFcfa: Int = 0) {
      context.startActivity(
        Intent(context, ShellPickRecipientActivity::class.java).apply {
          putExtra(EXTRA_PENDING_PAY_AMOUNT, pendingPayAmountFcfa.coerceAtLeast(0))
          if (context !is AppCompatActivity) {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        },
      )
    }
  }
}

private class RecipientPickAdapter(
  private val onPick: (BlypShellPayRuntime.RecipientOption) -> Unit,
) : RecyclerView.Adapter<RecipientPickAdapter.Holder>() {
  private var items: List<BlypShellPayRuntime.RecipientOption> = emptyList()

  fun submit(rows: List<BlypShellPayRuntime.RecipientOption>) {
    items = rows
    notifyDataSetChanged()
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
    val v =
      LayoutInflater.from(parent.context).inflate(R.layout.blyp_shell_route_row, parent, false)
    return Holder(v)
  }

  override fun getItemCount(): Int = items.size

  override fun onBindViewHolder(holder: Holder, position: Int) {
    holder.bind(items[position], onPick)
  }

  class Holder(itemView: View) : RecyclerView.ViewHolder(itemView) {
    private val title = itemView.findViewById<TextView>(R.id.blyp_route_row_title)
    private val sub = itemView.findViewById<TextView>(R.id.blyp_route_row_sub)

    fun bind(row: BlypShellPayRuntime.RecipientOption, onPick: (BlypShellPayRuntime.RecipientOption) -> Unit) {
      title.text = row.name
      val phone = row.phoneDigits?.replace(Regex("\\D"), "").orEmpty()
      sub.text =
        if (phone.length >= 9) {
          "+237 ${phone.take(3)} ${phone.drop(3).take(3)} ${phone.drop(6)}"
        } else {
          row.accountId
        }
      itemView.setOnClickListener { onPick(row) }
    }
  }
}
