package com.haroldndougou.blyp.shell

import android.app.Activity
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

class ShellForwardChatActivity : AppCompatActivity() {
  private var busy = false
  private lateinit var sourceId: String
  private lateinit var messageIds: ArrayList<String>

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    sourceId = intent.getStringExtra(EXTRA_SOURCE_CONV)?.trim().orEmpty()
    val ids = intent.getStringArrayExtra(EXTRA_MESSAGE_IDS)?.map { it.trim() }?.filter { it.isNotEmpty() }
    if (sourceId.isEmpty() || ids.isNullOrEmpty()) {
      finish()
      return
    }
    messageIds = ArrayList(ids)
    setContentView(R.layout.blyp_shell_pick_recipient)
    applySystemBarAppearance()
    findViewById<TextView>(R.id.blyp_pick_recipient_title).setText(R.string.blyp_shell_forward_title)
    findViewById<View>(R.id.blyp_pick_recipient_back).setOnClickListener { finish() }
    findViewById<EditText>(R.id.blyp_pick_recipient_phone).visibility = View.GONE
    findViewById<TextView>(R.id.blyp_pick_recipient_search).visibility = View.GONE
    val phone = BlypShellSession.phone(this).orEmpty()
    val rows =
      BlypShellConversationsStore.loadRows(this, phone).filter {
        it.id != sourceId
      }
    val adapter = ForwardAdapter(rows) { target -> forwardTo(target) }
    findViewById<RecyclerView>(R.id.blyp_pick_recipient_list).apply {
      layoutManager = LinearLayoutManager(this@ShellForwardChatActivity)
      this.adapter = adapter
    }
    findViewById<TextView>(R.id.blyp_pick_recipient_empty).visibility =
      if (rows.isEmpty()) View.VISIBLE else View.GONE
  }

  private fun forwardTo(targetId: String) {
    if (busy) return
    busy = true
    BlypShellChatForward.forwardAsync(this, sourceId, targetId, messageIds) { ok ->
      busy = false
      if (!ok) {
        Toast.makeText(this, R.string.blyp_shell_forward_failed, Toast.LENGTH_SHORT).show()
        return@forwardAsync
      }
      setResult(Activity.RESULT_OK)
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

  private class ForwardAdapter(
    private val rows: List<ShellConversationRow>,
    private val onPick: (String) -> Unit,
  ) : RecyclerView.Adapter<ForwardAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
      val v =
        LayoutInflater.from(parent.context)
          .inflate(R.layout.blyp_shell_messages_row, parent, false)
      return Holder(v)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
      holder.bind(rows[position], onPick)
    }

    override fun getItemCount(): Int = rows.size

    class Holder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      fun bind(row: ShellConversationRow, onPick: (String) -> Unit) {
        itemView.findViewById<TextView>(R.id.blyp_messages_peer_name).text = row.peerName
        itemView.findViewById<TextView>(R.id.blyp_messages_preview).text = row.preview
        itemView.setOnClickListener { onPick(row.id) }
      }
    }
  }

  companion object {
    private const val EXTRA_SOURCE_CONV = "blyp_fwd_source"
    private const val EXTRA_MESSAGE_IDS = "blyp_fwd_ids"

    fun buildIntent(
      context: Context,
      sourceConversationId: String,
      messageIds: List<String>,
    ): Intent =
      Intent(context, ShellForwardChatActivity::class.java).apply {
        putExtra(EXTRA_SOURCE_CONV, sourceConversationId.trim())
        putExtra(EXTRA_MESSAGE_IDS, messageIds.toTypedArray())
      }
  }
}