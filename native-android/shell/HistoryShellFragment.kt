package com.haroldndougou.blyp.shell

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

class HistoryShellFragment : Fragment() {
  private var listView: RecyclerView? = null
  private var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout? = null
  private var emptyBlock: View? = null
  private var emptyTextView: TextView? = null
  private var emptyCtaView: TextView? = null
  private var subtitleView: TextView? = null
  private var summaryRow: View? = null
  private var summarySentCard: LinearLayout? = null
  private var summaryReceivedCard: LinearLayout? = null
  private var summarySentValue: TextView? = null
  private var summaryReceivedValue: TextView? = null
  private var filter: HistoryFilter = HistoryFilter.ALL
  private var visibleTxLimit = HistoryListPagination.PAGE_SIZE
  private var cachedFullItems: List<ShellHistoryItem> = emptyList()
  private var operationsCount = 0
  private var unsubRefresh: (() -> Unit)? = null

  private val adapter =
    HistoryAdapter(
      onRowClick = { row -> ShellHistoryDetailDialog.show(this, row) },
      onSeeMore = {
        visibleTxLimit += HistoryListPagination.PAGE_SIZE
        applyPagination()
      },
    )

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_shell_history, container, false)
    swipeRefresh = root.findViewById(R.id.blyp_shell_history_swipe)
    listView = root.findViewById(R.id.blyp_shell_history_list)
    emptyBlock = root.findViewById(R.id.blyp_shell_history_empty)
    emptyTextView = root.findViewById(R.id.blyp_shell_history_empty_text)
    emptyCtaView = root.findViewById(R.id.blyp_shell_history_empty_cta)
    subtitleView = root.findViewById(R.id.blyp_shell_history_subtitle)
    summaryRow = root.findViewById(R.id.blyp_shell_history_summary_row)
    summarySentCard = root.findViewById(R.id.blyp_shell_summary_sent)
    summaryReceivedCard = root.findViewById(R.id.blyp_shell_summary_received)
    summarySentValue = root.findViewById(R.id.blyp_shell_summary_sent_value)
    summaryReceivedValue = root.findViewById(R.id.blyp_shell_summary_received_value)
    listView?.layoutManager = LinearLayoutManager(requireContext())
    listView?.adapter = adapter

    summarySentCard?.setOnClickListener { toggleFilter(HistoryFilter.SENT) }
    summaryReceivedCard?.setOnClickListener { toggleFilter(HistoryFilter.RECEIVED) }
    emptyCtaView?.setOnClickListener {
      (activity as? BlypNativeShellActivity)?.openPayTab()
    }
    swipeRefresh?.setColorSchemeResources(R.color.blyp_shell_accent)
    swipeRefresh?.setProgressBackgroundColorSchemeResource(R.color.blyp_shell_surface)
    swipeRefresh?.setOnRefreshListener { pullToRefresh() }
    return root
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
    BlypHistoryDeltaSync.syncAfterUserPull(ctx, phone) { syncOk ->
      if (!isAdded) return@syncAfterUserPull
      reload(fromNetwork = true)
      swipeRefresh?.isRefreshing = false
      if (!syncOk) {
        Toast.makeText(ctx, R.string.blyp_shell_history_sync_failed, Toast.LENGTH_SHORT).show()
      }
    }
  }

  override fun onStart() {
    super.onStart()
    unsubRefresh = BlypShellUiRefresh.subscribe { reload() }
  }

  override fun onStop() {
    unsubRefresh?.invoke()
    unsubRefresh = null
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    BlypShellPerfMarks.start("history_open")
    reload()
    BlypShellPerfMarks.end("history_open")
  }

  private fun toggleFilter(next: HistoryFilter) {
    filter =
      when {
        filter == next -> HistoryFilter.ALL
        next == HistoryFilter.SENT -> HistoryFilter.SENT
        else -> HistoryFilter.RECEIVED
      }
    visibleTxLimit = HistoryListPagination.PAGE_SIZE
    updateSummarySelection()
    reload(fromNetwork = true)
  }

  private fun updateSummarySelection() {
    val ctx = context ?: return
    val sentActive = filter == HistoryFilter.SENT
    val receivedActive = filter == HistoryFilter.RECEIVED
    summarySentCard?.setBackgroundResource(
      if (sentActive) R.drawable.blyp_shell_summary_card_active
      else R.drawable.blyp_shell_summary_card,
    )
    summaryReceivedCard?.setBackgroundResource(
      if (receivedActive) R.drawable.blyp_shell_summary_card_active
      else R.drawable.blyp_shell_summary_card,
    )
    summarySentValue?.setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_text))
    summaryReceivedValue?.setTextColor(
      ContextCompat.getColor(ctx, R.color.blyp_shell_success_amount),
    )
  }

  private fun applyPagination() {
    val page = HistoryListPagination.buildPage(cachedFullItems, visibleTxLimit)
    adapter.submit(page)
    val hasRows = cachedFullItems.any { it is ShellHistoryItem.Row }
    if (hasRows) {
      hideEmpty()
    } else {
      setEmpty(emptyMessageForFilter())
    }
  }

  private fun emptyMessageForFilter(): Int =
    when (filter) {
      HistoryFilter.SENT -> R.string.blyp_shell_history_empty_sent
      HistoryFilter.RECEIVED -> R.string.blyp_shell_history_empty_received
      HistoryFilter.ALL -> R.string.blyp_shell_history_empty
    }

  private fun setEmpty(messageRes: Int) {
    emptyBlock?.visibility = View.VISIBLE
    emptyTextView?.setText(messageRes)
    val commerce = context?.let { BlypShellSession.isCommerceMode(it) } == true
    val showPay = !commerce && filter == HistoryFilter.ALL && operationsCount == 0
    emptyCtaView?.visibility = if (showPay) View.VISIBLE else View.GONE
  }

  private fun hideEmpty() {
    emptyBlock?.visibility = View.GONE
  }

  private fun reload(fromNetwork: Boolean = false) {
    val ctx = context ?: return
    val phone = BlypShellSession.phone(ctx)
    if (phone.isNullOrEmpty()) {
      cachedFullItems = emptyList()
      adapter.submit(emptyList())
      operationsCount = 0
      setEmpty(R.string.blyp_shell_history_empty)
      emptyCtaView?.visibility = View.GONE
      summaryRow?.visibility = View.GONE
      subtitleView?.setText(R.string.blyp_shell_history_subtitle_empty)
      return
    }

    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val totals = BlypTransactionStore.computeTotals(ctx, phone)
    val opCount = BlypTransactionStore.countOperations(ctx, phone)
    operationsCount = opCount

    if (opCount > 0) {
      summaryRow?.visibility = View.VISIBLE
      summarySentValue?.text = amountFmt.format(totals.sentFcfa)
      summaryReceivedValue?.text = amountFmt.format(totals.receivedFcfa)
      updateSummarySelection()
      subtitleView?.text =
        if (opCount == 1) {
          getString(R.string.blyp_shell_history_subtitle_count_one)
        } else {
          getString(R.string.blyp_shell_history_subtitle_count, opCount)
        }
    } else {
      summaryRow?.visibility = View.GONE
      subtitleView?.setText(R.string.blyp_shell_history_subtitle_empty)
    }

    cachedFullItems = BlypTransactionStore.loadHistoryItems(ctx, phone, filter)
    if (cachedFullItems.isEmpty()) {
      adapter.submit(emptyList())
      setEmpty(emptyMessageForFilter())
    } else {
      applyPagination()
    }

    if (!fromNetwork) {
      BlypHistoryDeltaSync.scheduleAfterHistoryPaint(ctx, phone) { _ ->
        if (isAdded) reload(fromNetwork = true)
      }
    }
  }

  private class HistoryAdapter(
    private val onRowClick: (ShellHistoryRow) -> Unit,
    private val onSeeMore: () -> Unit,
  ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    private var items: List<HistoryListPagination.ListItem> = emptyList()

    fun submit(next: List<HistoryListPagination.ListItem>) {
      items = next
      notifyDataSetChanged()
    }

    override fun getItemViewType(position: Int): Int =
      when (items[position]) {
        is HistoryListPagination.ListItem.Header -> VIEW_HEADER
        is HistoryListPagination.ListItem.Row -> VIEW_ROW
        HistoryListPagination.ListItem.SeeMore -> VIEW_SEE_MORE
      }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
      val inflater = LayoutInflater.from(parent.context)
      return when (viewType) {
        VIEW_HEADER ->
          HeaderHolder(inflater.inflate(R.layout.blyp_shell_history_header, parent, false))
        VIEW_SEE_MORE ->
          SeeMoreHolder(inflater.inflate(R.layout.blyp_shell_history_see_more, parent, false))
        else ->
          RowHolder(
            inflater.inflate(R.layout.blyp_shell_history_row, parent, false),
            onRowClick,
          )
      }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
      when (val item = items[position]) {
        is HistoryListPagination.ListItem.Header ->
          (holder as HeaderHolder).bind(item.title, item.total)
        is HistoryListPagination.ListItem.Row ->
          (holder as RowHolder).bind(item.row)
        HistoryListPagination.ListItem.SeeMore ->
          (holder as SeeMoreHolder).itemView.setOnClickListener { onSeeMore() }
      }
    }

    override fun getItemCount(): Int = items.size

    class HeaderHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val title = itemView.findViewById<TextView>(R.id.blyp_history_header_title)
      private val total = itemView.findViewById<TextView>(R.id.blyp_history_header_total)
      fun bind(text: String, sum: String?) {
        title.text = text.uppercase(Locale.getDefault())
        if (sum.isNullOrEmpty()) {
          total.visibility = View.GONE
        } else {
          total.text = sum
          total.visibility = View.VISIBLE
        }
      }
    }

    class SeeMoreHolder(itemView: View) : RecyclerView.ViewHolder(itemView)

    class RowHolder(
      itemView: View,
      private val onRowClick: (ShellHistoryRow) -> Unit,
    ) : RecyclerView.ViewHolder(itemView) {
      private val icon = itemView.findViewById<TextView>(R.id.blyp_history_icon)
      private val avatar = itemView.findViewById<android.widget.ImageView>(R.id.blyp_history_avatar)
      private val name = itemView.findViewById<TextView>(R.id.blyp_history_name)
      private val meta = itemView.findViewById<TextView>(R.id.blyp_history_meta)
      private val ref = itemView.findViewById<TextView>(R.id.blyp_history_ref)
      private val amount = itemView.findViewById<TextView>(R.id.blyp_history_amount)
      private val typeChip = itemView.findViewById<TextView>(R.id.blyp_history_type_chip)

      fun bind(row: ShellHistoryRow) {
        val ctx = itemView.context
        val isReceived = row.type == "received"
        name.text = row.name
        meta.text = row.dateLabel
        if (row.reference.isNullOrBlank()) {
          ref.visibility = View.GONE
        } else {
          ref.visibility = View.VISIBLE
          ref.text = row.reference
        }
        amount.text =
          if (isReceived) "+ ${row.amountLabel}" else "− ${row.amountLabel}"
        val success = ContextCompat.getColor(ctx, R.color.blyp_shell_success_amount)
        val sent = ContextCompat.getColor(ctx, R.color.blyp_shell_sent_amount)
        amount.setTextColor(if (isReceived) success else sent)

        icon.setBackgroundResource(
          if (isReceived) R.drawable.blyp_shell_icon_received_bg
          else R.drawable.blyp_shell_icon_sent_bg,
        )
        val initialLetter = row.name.trim().firstOrNull { it.isLetter() }?.uppercaseChar()?.toString()
        when {
          isReceived -> {
            icon.text = "↓"
            icon.setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_accent))
          }
          initialLetter != null -> {
            icon.text = initialLetter
            icon.setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_avatar_text))
          }
          else -> {
            icon.text = "↑"
            icon.setTextColor(
              ContextCompat.getColor(ctx, R.color.blyp_shell_text_secondary),
            )
          }
        }

        typeChip.setText(
          if (isReceived) R.string.blyp_shell_history_type_received
          else R.string.blyp_shell_history_type_sent,
        )

        itemView.setOnClickListener {
          onRowClick(row)
        }

        avatar.visibility = View.GONE
        icon.visibility = View.VISIBLE
        if (!isReceived && !row.counterpartyPhone.isNullOrBlank()) {
          val initial =
            row.name.trim().firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
          val url = BlypShellPeerAvatar.urlForPhone(ctx, row.counterpartyPhone)
          if (!url.isNullOrBlank()) {
            avatar.outlineProvider =
              object : android.view.ViewOutlineProvider() {
                override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
                  outline.setOval(0, 0, view.width, view.height)
                }
              }
            avatar.clipToOutline = true
            BlypShellAvatarLoader.loadInto(url, avatar, icon, initial)
          }
        }
      }
    }

    companion object {
      private const val VIEW_HEADER = 0
      private const val VIEW_ROW = 1
      private const val VIEW_SEE_MORE = 2
    }
  }
}
