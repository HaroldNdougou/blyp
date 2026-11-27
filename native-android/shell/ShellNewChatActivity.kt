package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.net.Uri
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R

/** Nouvelle discussion — contacts du téléphone qui ont Blyp. */
class ShellNewChatActivity : AppCompatActivity() {
  private var busy = false
  private lateinit var adapter: NewChatAdapter
  private val askContacts =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) loadBlypContacts() else showContactsDenied()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_pick_recipient)
    applySystemBarAppearance()
    findViewById<TextView>(R.id.blyp_pick_recipient_title).setText(R.string.blyp_shell_messages_new_chat)
    findViewById<View>(R.id.blyp_pick_recipient_back).setOnClickListener { finish() }
    findViewById<View>(R.id.blyp_pick_recipient_manual).visibility = View.GONE
    val phoneInput = findViewById<EditText>(R.id.blyp_pick_recipient_phone)
    adapter = NewChatAdapter { openPhone(it) }
    findViewById<RecyclerView>(R.id.blyp_pick_recipient_list).apply {
      layoutManager = LinearLayoutManager(this@ShellNewChatActivity)
      adapter = this@ShellNewChatActivity.adapter
    }
    findViewById<TextView>(R.id.blyp_pick_recipient_search).apply {
      setText(R.string.blyp_shell_new_chat_open)
      setOnClickListener { openPhone(phoneInput.text.toString()) }
    }
    findViewById<TextView>(R.id.blyp_pick_recipient_section)
      .setText(R.string.blyp_shell_new_chat_contacts)
    if (
      ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) ==
        PackageManager.PERMISSION_GRANTED
    ) {
      loadBlypContacts()
    } else {
      askContacts.launch(Manifest.permission.READ_CONTACTS)
    }
  }

  private fun loadBlypContacts() {
    val cached = BlypShellPhoneContacts.cached(this)
    if (cached != null) {
      setBusy(false)
      showRows(cached, settled = false)
    } else {
      setBusy(true)
    }
    BlypShellPhoneContacts.loadOnBlypAsync(this) { rows, failed ->
      if (isDestroyed) return@loadOnBlypAsync
      setBusy(false)
      if (rows != null) {
        showRows(rows, settled = true)
      } else if (cached == null) {
        adapter.submit(emptyList())
        val empty = findViewById<TextView>(R.id.blyp_pick_recipient_empty)
        empty.setText(
          if (failed) R.string.blyp_shell_new_chat_contacts_failed
          else R.string.blyp_shell_new_chat_contacts_empty,
        )
        empty.visibility = View.VISIBLE
      }
    }
  }

  private fun showContactsDenied() {
    setBusy(false)
    adapter.submit(emptyList())
    val empty = findViewById<TextView>(R.id.blyp_pick_recipient_empty)
    empty.setText(R.string.blyp_shell_new_chat_contacts_denied)
    empty.visibility = View.VISIBLE
  }

  private fun setBusy(on: Boolean) {
    findViewById<View>(R.id.blyp_pick_recipient_busy).visibility =
      if (on) View.VISIBLE else View.GONE
  }

  private fun showRows(rows: List<BlypShellPhoneContacts.Row>, settled: Boolean) {
    adapter.submit(rows)
    val empty = findViewById<TextView>(R.id.blyp_pick_recipient_empty)
    if (rows.isEmpty() && settled) {
      empty.setText(R.string.blyp_shell_new_chat_contacts_empty)
      empty.visibility = View.VISIBLE
    } else {
      empty.visibility = View.GONE
    }
  }

  private fun openPhone(phoneRaw: String) {
    if (busy) return
    busy = true
    BlypButtonSpinner.show(findViewById(R.id.blyp_pick_recipient_search))
    findViewById<TextView>(R.id.blyp_pick_recipient_search).alpha = 0.55f
    BlypShellConversationsOpen.openByPhoneAsync(this, phoneRaw) { ok, convId, err ->
      busy = false
      findViewById<TextView>(R.id.blyp_pick_recipient_search).alpha = 1f
      BlypButtonSpinner.hide(findViewById(R.id.blyp_pick_recipient_search))
      if (!ok || convId.isNullOrEmpty()) {
        toast(err ?: getString(R.string.blyp_shell_new_chat_failed))
        return@openByPhoneAsync
      }
      val name =
        adapter.nameForPhoneDigits(phoneRaw)
          ?: BlypShellPhoneContacts.cached(this)
            ?.firstOrNull {
              it.phoneDigits == BlypShellAuthClient.normalizePhoneDigits(phoneRaw)
            }
            ?.name
      val owner = BlypShellSession.phone(this).orEmpty()
      BlypShellConversationsStore.touchOpened(this, owner, convId, name, phoneRaw)
      BlypShellConversationsListGate.markPulled()
      BlypShellConversationsSync.syncAfterUserPull(applicationContext, owner) { }
      finish()
      ShellChatThreadActivity.start(this, convId, name, phoneRaw)
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

  private class NewChatAdapter(
    private val onPick: (String) -> Unit,
  ) : RecyclerView.Adapter<NewChatAdapter.Holder>() {
    private var items: List<BlypShellPhoneContacts.Row> = emptyList()

    fun submit(next: List<BlypShellPhoneContacts.Row>) {
      items = next
      notifyDataSetChanged()
    }

    fun nameForPhoneDigits(raw: String): String? {
      val nine = BlypShellAuthClient.normalizePhoneDigits(raw) ?: return null
      return items.firstOrNull { it.phoneDigits == nine }?.name
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
      val v =
        LayoutInflater.from(parent.context)
          .inflate(R.layout.blyp_shell_new_chat_row, parent, false)
      return Holder(v, onPick)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
      holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class Holder(
      itemView: View,
      private val onPick: (String) -> Unit,
    ) : RecyclerView.ViewHolder(itemView) {
      private val nameView = itemView.findViewById<TextView>(R.id.blyp_new_chat_name)
      private val phoneView = itemView.findViewById<TextView>(R.id.blyp_new_chat_phone)
      private val avatar = itemView.findViewById<ImageView>(R.id.blyp_new_chat_avatar)
      private val initial = itemView.findViewById<TextView>(R.id.blyp_new_chat_initial)

      fun bind(row: BlypShellPhoneContacts.Row) {
        val nine = row.phoneDigits
        nameView.text = row.name
        phoneView.text = "+237 ${nine.take(3)} ${nine.drop(3).take(3)} ${nine.drop(6)}"
        avatar.clipToOutline = false
        val local = row.photoUri
        if (!local.isNullOrBlank()) {
          avatar.setTag(R.id.blyp_avatar_load_url, null)
          avatar.setImageURI(Uri.parse(local))
          avatar.visibility = View.VISIBLE
          initial.visibility = View.GONE
        } else {
          val url = BlypShellPeerAvatar.urlForPhone(itemView.context, nine)
          BlypShellAvatarLoader.loadInto(
            url,
            avatar,
            initial,
            "",
            R.drawable.blyp_shell_contact_placeholder,
          )
        }
        itemView.setOnClickListener { onPick(nine) }
      }
    }
  }

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellNewChatActivity::class.java).apply {
          if (context !is AppCompatActivity) {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        },
      )
    }
  }
}