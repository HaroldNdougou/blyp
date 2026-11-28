package com.haroldndougou.blyp.shell

import android.os.Bundle
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R

class MessagesListFragment : Fragment() {
  private var listView: RecyclerView? = null
  private var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout? = null
  private var emptyBlock: LinearLayout? = null
  private var cachedRows: List<ShellConversationRow> = emptyList()
  private var unreadStamp: String = ""
  private var typingStamp: String = ""
  private var unsubRefresh: (() -> Unit)? = null
  private var unsubListRt: (() -> Unit)? = null
  private var unsubTyping: (() -> Unit)? = null
  private var loadedOnce = false
  private var autoNewChatShown = false
  private var pendingDeleteId: String? = null
  private var deleteIcon: ImageView? = null
  private val adapter = ConversationsAdapter(::openChat, ::armDelete)

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_shell_messages_list, container, false)
    swipeRefresh = root.findViewById(R.id.blyp_shell_messages_swipe)
    listView = root.findViewById(R.id.blyp_shell_messages_list)
    emptyBlock = root.findViewById(R.id.blyp_shell_messages_empty)
    listView?.layoutManager = LinearLayoutManager(requireContext())
    listView?.itemAnimator = null
    listView?.setHasFixedSize(true)
    listView?.adapter = adapter
    swipeRefresh?.setColorSchemeResources(R.color.blyp_shell_accent)
    swipeRefresh?.setProgressBackgroundColorSchemeResource(R.color.blyp_shell_surface)
    swipeRefresh?.setOnRefreshListener { pullToRefresh() }
    root.findViewById<TextView>(R.id.blyp_shell_messages_empty_cta)?.setOnClickListener {
      ShellNewChatActivity.start(requireContext())
    }
    root.findViewById<android.widget.ImageView>(R.id.blyp_shell_messages_compose)?.setOnClickListener {
      clearDeleteArm()
      ShellNewChatActivity.start(requireContext())
    }
    deleteIcon = root.findViewById(R.id.blyp_shell_messages_delete)
    deleteIcon?.setOnClickListener { confirmDelete() }
    root.findViewById<View>(R.id.blyp_shell_messages_header)?.setOnClickListener { clearDeleteArm() }
    listView?.setOnTouchListener { v, event ->
      if (event.action == MotionEvent.ACTION_UP && pendingDeleteId != null) {
        val under = (v as? RecyclerView)?.findChildViewUnder(event.x, event.y)
        if (under == null) clearDeleteArm()
      }
      false
    }
    return root
  }

  override fun onStart() {
    super.onStart()
    unsubRefresh = BlypShellUiRefresh.subscribe { reload() }
    unsubListRt = BlypShellChatRealtime.subscribeList { reload() }
    unsubTyping = BlypShellChatTyping.subscribe { reload() }
  }

  override fun onStop() {
    unsubRefresh?.invoke()
    unsubRefresh = null
    unsubListRt?.invoke()
    unsubListRt = null
    unsubTyping?.invoke()
    unsubTyping = null
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    BlypShellClicks.arm(view)
    reload()
  }

  private fun pullToRefresh() {
    val ctx = context ?: run {
      swipeRefresh?.isRefreshing = false
      return
    }
    val phone = BlypShellSession.phone(ctx)
    if (phone.isNullOrEmpty()) {
      swipeRefresh?.isRefreshing = false
      return
    }
    BlypShellConversationsSync.syncAfterUserPull(ctx, phone) { syncOk ->
      if (!isAdded) return@syncAfterUserPull
      reload()
      swipeRefresh?.isRefreshing = false
      if (!syncOk) {
        Toast.makeText(ctx, R.string.blyp_shell_messages_sync_failed, Toast.LENGTH_SHORT).show()
      }
    }
  }

  private fun reload() {
    val ctx = context ?: return
    val phone = BlypShellSession.phone(ctx)
    if (phone.isNullOrEmpty()) {
      cachedRows = emptyList()
      adapter.submit(emptyList())
      showEmpty(true)
      return
    }
    BlypShellPhoneContacts.warmNames(ctx) { reload() }
    val next = BlypShellConversationsStore.loadRows(ctx, phone)
    val unreadNow = next.joinToString(",") { it.id + ":" + BlypShellChatUnread.count(ctx, it.id) }
    val typingNow = next.joinToString(",") { it.id + ":" + BlypShellChatTyping.isOn(it.id) }
    if (
      unreadNow != unreadStamp ||
      typingNow != typingStamp ||
      !BlypShellConversationsStore.rowsEqual(cachedRows, next)
    ) {
      unreadStamp = unreadNow
      typingStamp = typingNow
      cachedRows = next
      adapter.submit(next)
    }
    loadedOnce = true
    showEmpty(next.isEmpty())
    view?.post {
      if (!isAdded) return@post
      BlypShellConversationsSync.scheduleAfterListPaint(ctx.applicationContext, phone) { syncOk ->
        if (!isAdded || !syncOk) return@scheduleAfterListPaint
        val refreshed = BlypShellConversationsStore.loadRows(ctx.applicationContext, phone)
        val unreadNow =
          refreshed.joinToString(",") {
            it.id + ":" + BlypShellChatUnread.count(ctx.applicationContext, it.id)
          }
        if (
          unreadNow != unreadStamp ||
            !BlypShellConversationsStore.rowsEqual(cachedRows, refreshed)
        ) {
          unreadStamp = unreadNow
          cachedRows = refreshed
          adapter.submit(refreshed)
          loadedOnce = true
          showEmpty(refreshed.isEmpty())
        }
      }
    }
  }

  fun onInboxVisibility(visible: Boolean) {
    if (!visible) {
      autoNewChatShown = false
      return
    }
    if (loadedOnce && cachedRows.isEmpty()) maybeAutoNewChat()
  }

  private fun showEmpty(show: Boolean) {
    emptyBlock?.visibility = if (show) View.VISIBLE else View.GONE
    swipeRefresh?.visibility = if (show) View.GONE else View.VISIBLE
    if (!show) {
      autoNewChatShown = false
      return
    }
    maybeAutoNewChat()
  }

  private fun maybeAutoNewChat() {
    if (autoNewChatShown || !isAdded || !loadedOnce || cachedRows.isNotEmpty()) return
    val ctx = context ?: return
    if (BlypShellSession.phone(ctx).isNullOrEmpty()) return
    autoNewChatShown = true
    ShellNewChatActivity.start(ctx)
  }

  private fun openChat(conversationId: String) {
    clearDeleteArm()
    val id = conversationId.trim()
    if (id.isEmpty()) return
    BlypShellChatUnread.clear(requireContext(), id)
    unreadStamp = ""
    adapter.submit(cachedRows)
    val row = cachedRows.firstOrNull { it.id == id }
    ShellChatThreadActivity.start(
      requireContext(),
      id,
      row?.peerName,
      row?.peerPhone,
      row?.avatarUrl,
    )
    requireActivity().overridePendingTransition(R.anim.blyp_chat_enter, R.anim.blyp_chat_exit)
  }

  private fun armDelete(conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    pendingDeleteId = id
    deleteIcon?.visibility = View.VISIBLE
    adapter.setSelected(id)
    view?.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
  }

  private fun clearDeleteArm() {
    if (pendingDeleteId == null && deleteIcon?.visibility != View.VISIBLE) return
    pendingDeleteId = null
    deleteIcon?.visibility = View.GONE
    adapter.setSelected(null)
  }

  private fun confirmDelete() {
    val ctx = context ?: return
    val id = pendingDeleteId ?: return
    val name = cachedRows.firstOrNull { it.id == id }?.peerName?.trim().orEmpty().ifEmpty { "…" }
    BlypShellDialogs.alertBuilder(ctx)
      .setTitle(R.string.blyp_shell_messages_delete_title)
      .setMessage(getString(R.string.blyp_shell_messages_delete_msg, name))
      .setNegativeButton(R.string.blyp_shell_chat_reply_cancel, null)
      .setPositiveButton(R.string.blyp_shell_messages_delete_confirm) { _, _ ->
        val phone = BlypShellSession.phone(ctx) ?: return@setPositiveButton
        BlypShellConversationsStore.hideFromList(ctx, phone, id)
        BlypShellChatUnread.clear(ctx, id)
        clearDeleteArm()
        reload()
      }
      .show()
  }

  private class ConversationsAdapter(
    private val onOpen: (String) -> Unit,
    private val onLong: (String) -> Unit,
  ) : RecyclerView.Adapter<ConversationsAdapter.RowHolder>() {
    private var items: List<ShellConversationRow> = emptyList()
    private var selectedId: String? = null

    fun setSelected(id: String?) {
      selectedId = id
      notifyDataSetChanged()
    }

    fun submit(next: List<ShellConversationRow>) {
      items = next
      notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RowHolder {
      val v =
        LayoutInflater.from(parent.context)
          .inflate(R.layout.blyp_shell_messages_row, parent, false)
      BlypShellClicks.arm(v)
      return RowHolder(v, onOpen, onLong)
    }

    override fun onBindViewHolder(holder: RowHolder, position: Int) {
      val row = items[position]
      holder.bind(row, row.id == selectedId)
    }

    override fun getItemCount(): Int = items.size

    class RowHolder(
      itemView: View,
      private val onOpen: (String) -> Unit,
      private val onLong: (String) -> Unit,
    ) : RecyclerView.ViewHolder(itemView) {
      private val initial = itemView.findViewById<TextView>(R.id.blyp_messages_peer_initial)
      private val avatar = itemView.findViewById<ImageView>(R.id.blyp_messages_peer_avatar)
      private val name = itemView.findViewById<TextView>(R.id.blyp_messages_peer_name)
      private val whenView = itemView.findViewById<TextView>(R.id.blyp_messages_when)
      private val preview = itemView.findViewById<TextView>(R.id.blyp_messages_preview)

      fun bind(row: ShellConversationRow, selected: Boolean) {
        itemView.setBackgroundResource(R.drawable.blyp_shell_messages_press)
        itemView.isSelected = selected
        itemView.isPressed = false
        itemView.setOnLongClickListener {
          onLong(row.id)
          true
        }
        name.text = row.peerName
        whenView.text = row.whenLabel
        val typing = BlypShellChatTyping.isOn(row.id)
        if (typing) {
          preview.setCompoundDrawablesRelative(null, null, null, null)
          preview.setTextColor(
            androidx.core.content.ContextCompat.getColor(
              itemView.context,
              R.color.blyp_shell_accent,
            ),
          )
          preview.text = itemView.context.getString(R.string.blyp_shell_chat_typing)
        } else {
          preview.setTextColor(
            androidx.core.content.ContextCompat.getColor(
              itemView.context,
              R.color.blyp_shell_text_secondary,
            ),
          )
          val raw = row.preview.trim()
          val reactionPreview = raw.indexOf('\t') >= 0
          val emojiOnly =
            !reactionPreview && raw.isNotEmpty() && raw.none { it.isLetterOrDigit() }
          preview.textSize =
            when {
              reactionPreview -> 13f
              emojiOnly -> 22f
              else -> 15f
            }
          preview.setTextColor(
            androidx.core.content.ContextCompat.getColor(
              itemView.context,
              if (emojiOnly) R.color.blyp_shell_text else R.color.blyp_shell_text_secondary,
            ),
          )
          if (BlypShellChatModes.incognito(itemView.context, row.id)) {
            preview.textSize = 15f
            preview.text = itemView.context.getString(R.string.blyp_shell_messages_incognito_preview)
            val letter =
              row.peerName.trim().firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
            avatar.clipToOutline = true
            initial.clipToOutline = true
            BlypShellAvatarLoader.loadInto(row.avatarUrl, avatar, initial, letter)
            val unread = itemView.findViewById<TextView>(R.id.blyp_messages_unread)
            val count = BlypShellChatUnread.count(itemView.context, row.id)
            if (count <= 0) unread.visibility = View.GONE else {
              unread.visibility = View.VISIBLE
              unread.text = ""
            }
            bindOpen(row.id)
            return
          }
          val ctx = itemView.context
          val d = ctx.resources.displayMetrics.density
          when {
            raw.equals("VOICE", true) ||
              raw == "🎤" ||
              raw.startsWith("🎤") ||
              raw.equals(ctx.getString(R.string.blyp_shell_chat_label_voice), true) ||
              raw.equals(ctx.getString(R.string.blyp_shell_chat_type_voice), true) -> {
              preview.setCompoundDrawablePadding((5 * d).toInt())
              val mic =
                androidx.core.content.ContextCompat
                  .getDrawable(ctx, R.drawable.blyp_shell_ic_mic_muted)
                  ?.mutate()
              val micSize = (22f * d).toInt()
              mic?.setBounds(0, 0, micSize, micSize)
              preview.setCompoundDrawablesRelative(mic, null, null, null)
              preview.text = ctx.getString(R.string.blyp_shell_chat_label_voice)
              preview.textSize = 15f
            }
            raw.equals("IMAGE", true) ||
              raw == "📷" ||
              raw.startsWith("📷") ||
              raw.equals("Photo", true) -> {
              preview.setCompoundDrawablePadding((6 * d).toInt())
              preview.setCompoundDrawablesRelativeWithIntrinsicBounds(
                R.drawable.blyp_shell_ic_photos_muted,
                0,
                0,
                0,
              )
              preview.text = ctx.getString(R.string.blyp_shell_messages_photo_preview)
              preview.textSize = 15f
            }
            raw.isEmpty() -> {
              preview.setCompoundDrawablesRelative(null, null, null, null)
              preview.text = ctx.getString(R.string.blyp_shell_messages_preview_empty)
            }
            else -> {
              preview.setCompoundDrawablesRelative(null, null, null, null)
              val placeLabel =
                BlypShellPlaceCodec.previewFromBody(
                  raw,
                  ctx.getString(R.string.blyp_shell_chat_place_preview_live),
                  ctx.getString(R.string.blyp_shell_chat_place_preview),
                )
              val reactLabel = formatReactionPreview(ctx, raw)
              preview.text = placeLabel ?: reactLabel ?: raw
              if (reactLabel != null) {
                preview.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 13f)
                preview.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL))
                preview.setTextColor(
                  androidx.core.content.ContextCompat.getColor(
                    ctx,
                    R.color.blyp_shell_text_secondary,
                  ),
                )
              }
              val draftPrefix = ctx.getString(R.string.blyp_shell_messages_draft_prefix)
              if (raw.startsWith(draftPrefix)) {
                preview.setTextColor(
                  androidx.core.content.ContextCompat.getColor(
                    ctx,
                    R.color.blyp_shell_accent,
                  ),
                )
                preview.textSize = 15f
              }
            }
          }
        }
        val letter =
          row.peerName.trim().firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
        avatar.clipToOutline = true
        initial.clipToOutline = true
        BlypShellAvatarLoader.loadInto(row.avatarUrl, avatar, initial, letter)
        val unread = itemView.findViewById<TextView>(R.id.blyp_messages_unread)
        val count = BlypShellChatUnread.count(itemView.context, row.id)
        if (count <= 0) {
          unread.visibility = View.GONE
        } else {
          unread.visibility = View.VISIBLE
          unread.text = ""
        }
        bindOpen(row.id)
      }

      private fun bindOpen(conversationId: String) {
        itemView.setOnClickListener { onOpen(conversationId) }
      }

      private fun formatReactionPreview(ctx: android.content.Context, raw: String): String? {
        val tab = raw.indexOf('\t')
        if (tab < 0) {
          if (BlypShellReactionCodec.isSyncBody(raw)) return null
          return null
        }
        val who = raw.substring(0, tab).trim()
        val emoji = raw.substring(tab + 1).trim()
        if (emoji.isEmpty()) return ctx.getString(R.string.blyp_shell_messages_reaction_bare)
        return if (who == "*") {
          ctx.getString(R.string.blyp_shell_messages_reaction_you, emoji)
        } else {
          ctx.getString(R.string.blyp_shell_messages_reaction, emoji)
        }
      }
    }
  }
}