package com.haroldndougou.blyp.shell

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
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
  private var searchField: EditText? = null
  private var filterChip: TextView? = null
  private var filter: HistoryFilter = HistoryFilter.ALL
  private var searchQuery: HistorySearch.Query = HistorySearch.Query()
  private var searchReady = false
  private var visibleTxLimit = HistoryListPagination.PAGE_SIZE
  private var cachedFullItems: List<ShellHistoryItem> = emptyList()
  private var operationsCount = 0
  private var bookShopId: String? = null
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
    searchField = root.findViewById(R.id.blyp_shell_history_search)
    filterChip = root.findViewById(R.id.blyp_shell_history_filter_chip)
    listView?.layoutManager = LinearLayoutManager(requireContext())
    listView?.adapter = adapter
    searchQuery = HistorySearch.load(requireContext())
    if (searchQuery.text.isNotEmpty()) {
      searchField?.setText(searchQuery.text)
      searchField?.setSelection(searchQuery.text.length)
    }
    paintFilterChip()
    searchReady = true

    summarySentCard?.setOnClickListener { toggleFilter(HistoryFilter.SENT) }
    summaryReceivedCard?.setOnClickListener { toggleFilter(HistoryFilter.RECEIVED) }
    emptyCtaView?.setOnClickListener {
      (activity as? BlypNativeShellActivity)?.openPayTab()
    }
    root.findViewById<ImageView>(R.id.blyp_shell_history_filter_btn)?.setOnClickListener {
      showAdvancedFilters()
    }
    filterChip?.setOnClickListener { showAdvancedFilters() }
    searchField?.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}

        override fun afterTextChanged(s: Editable?) {
          if (!searchReady) return
          searchQuery = searchQuery.copy(text = s?.toString().orEmpty())
          persistSearch()
          visibleTxLimit = HistoryListPagination.PAGE_SIZE
          applyPagination()
        }
      },
    )
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

  private fun filteredItems(): List<ShellHistoryItem> =
    HistorySearch.apply(cachedFullItems, searchQuery)

  private fun persistSearch() {
    val ctx = context ?: return
    HistorySearch.save(ctx, searchQuery)
  }

  private fun applyPagination() {
    val filtered = filteredItems()
    val page = HistoryListPagination.buildPage(filtered, visibleTxLimit)
    adapter.submit(page)
    val hasRows = filtered.any { it is ShellHistoryItem.Row }
    if (hasRows) {
      hideEmpty()
    } else if (cachedFullItems.any { it is ShellHistoryItem.Row } && !searchQuery.isEmpty) {
      setEmpty(R.string.blyp_shell_history_empty_search, showPayCta = false)
    } else {
      setEmpty(emptyMessageForFilter())
    }
    paintFilterChip()
  }

  private fun emptyMessageForFilter(): Int =
    when (filter) {
      HistoryFilter.SENT -> R.string.blyp_shell_history_empty_sent
      HistoryFilter.RECEIVED -> R.string.blyp_shell_history_empty_received
      HistoryFilter.ALL -> R.string.blyp_shell_history_empty
    }

  private fun paintFilterChip() {
    val advanced =
      searchQuery.date != HistorySearch.DateWindow.ALL ||
        searchQuery.minAmount != null ||
        searchQuery.maxAmount != null
    if (!advanced) {
      filterChip?.visibility = View.GONE
      return
    }
    filterChip?.visibility = View.VISIBLE
    filterChip?.setText(R.string.blyp_shell_history_filter_active)
  }

  private fun showAdvancedFilters() {
    val ctx = context ?: return
    val density = resources.displayMetrics.density
    val pad = (16 * density).toInt()
    val gap = (10 * density).toInt()
    val root = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(pad, pad, pad, pad / 2)
    }
    val dateLabel =
      TextView(ctx).apply {
        setText(R.string.blyp_shell_history_filter_date)
        setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_muted))
        textSize = 12f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      }
    root.addView(dateLabel)
    val dateOptions =
      arrayOf(
        HistorySearch.DateWindow.ALL to R.string.blyp_shell_history_filter_date_all,
        HistorySearch.DateWindow.D7 to R.string.blyp_shell_history_filter_date_7,
        HistorySearch.DateWindow.D30 to R.string.blyp_shell_history_filter_date_30,
        HistorySearch.DateWindow.D90 to R.string.blyp_shell_history_filter_date_90,
      )
    val dateGroup = android.widget.RadioGroup(ctx).apply { orientation = LinearLayout.VERTICAL }
    for ((window, labelRes) in dateOptions) {
      val radio =
        android.widget.RadioButton(ctx).apply {
          id = View.generateViewId()
          setText(labelRes)
          tag = window
          isChecked = searchQuery.date == window
        }
      dateGroup.addView(radio)
    }
    root.addView(dateGroup)
    val amountLabel =
      TextView(ctx).apply {
        setText(R.string.blyp_shell_history_filter_amount)
        setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_muted))
        textSize = 12f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, gap, 0, gap / 2)
      }
    root.addView(amountLabel)
    val amountRow =
      LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = android.view.Gravity.CENTER_VERTICAL
      }
    fun amountField(hintRes: Int, value: Int?): EditText =
      EditText(ctx).apply {
        layoutParams =
          LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginEnd = gap / 2
          }
        setHint(hintRes)
        inputType = android.text.InputType.TYPE_CLASS_NUMBER
        setText(value?.toString().orEmpty())
        setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_text))
        setHintTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_hint))
        textSize = 15f
      }
    val minField = amountField(R.string.blyp_shell_history_filter_amount_min, searchQuery.minAmount)
    val maxField =
      amountField(R.string.blyp_shell_history_filter_amount_max, searchQuery.maxAmount).also {
        (it.layoutParams as LinearLayout.LayoutParams).marginEnd = 0
        (it.layoutParams as LinearLayout.LayoutParams).marginStart = gap / 2
      }
    amountRow.addView(minField)
    amountRow.addView(maxField)
    root.addView(amountRow)

    AlertDialog.Builder(ctx)
      .setTitle(R.string.blyp_shell_history_filter_title)
      .setView(root)
      .setPositiveButton(R.string.blyp_shell_history_filter_apply) { _, _ ->
        val checkedId = dateGroup.checkedRadioButtonId
        val picked =
          if (checkedId != View.NO_ID) {
            dateGroup.findViewById<android.widget.RadioButton>(checkedId)?.tag
              as? HistorySearch.DateWindow
          } else {
            null
          } ?: HistorySearch.DateWindow.ALL
        fun parseAmount(field: EditText): Int? {
          val raw = field.text?.toString()?.filter { it.isDigit() }.orEmpty()
          if (raw.isEmpty()) return null
          return raw.toIntOrNull()?.takeIf { it >= 0 }
        }
        var min = parseAmount(minField)
        var max = parseAmount(maxField)
        if (min != null && max != null && min > max) {
          val swap = min
          min = max
          max = swap
        }
        searchQuery = searchQuery.copy(date = picked, minAmount = min, maxAmount = max)
        persistSearch()
        visibleTxLimit = HistoryListPagination.PAGE_SIZE
        applyPagination()
      }
      .setNeutralButton(R.string.blyp_shell_history_filter_clear) { _, _ ->
        searchQuery =
          HistorySearch.Query(
            text = searchQuery.text,
            date = HistorySearch.DateWindow.ALL,
            minAmount = null,
            maxAmount = null,
          )
        persistSearch()
        visibleTxLimit = HistoryListPagination.PAGE_SIZE
        applyPagination()
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun setEmpty(messageRes: Int, showPayCta: Boolean? = null) {
    emptyBlock?.visibility = View.VISIBLE
    emptyTextView?.setText(messageRes)
    val commerce = context?.let { BlypShellSession.isCommerceMode(it) } == true
    val showPay =
      showPayCta
        ?: (!commerce && filter == HistoryFilter.ALL && operationsCount == 0 && searchQuery.isEmpty)
    emptyCtaView?.visibility = if (showPay) View.VISIBLE else View.GONE
  }

  private fun hideEmpty() {
    emptyBlock?.visibility = View.GONE
  }

  private fun paintBookChrome(
    ctx: android.content.Context,
    commerce: Boolean,
    shops: List<ShellCommerceEntry>,
  ) {
    view?.findViewById<TextView>(R.id.blyp_shell_history_title)?.setText(
      if (commerce) R.string.blyp_shell_book_title else R.string.blyp_shell_history_title,
    )
    view?.findViewById<TextView>(R.id.blyp_shell_summary_sent_label)?.setText(
      if (commerce) R.string.blyp_shell_book_out else R.string.blyp_shell_history_summary_sent,
    )
    view?.findViewById<TextView>(R.id.blyp_shell_summary_received_label)?.setText(
      if (commerce) R.string.blyp_shell_book_in else R.string.blyp_shell_history_summary_received,
    )
    val scroll = view?.findViewById<View>(R.id.blyp_shell_history_shops_scroll)
    val row = view?.findViewById<LinearLayout>(R.id.blyp_shell_history_shops)
    if (!commerce || shops.size < 2 || row == null) {
      scroll?.visibility = View.GONE
      return
    }
    scroll?.visibility = View.VISIBLE
    if (row.childCount == shops.size + 1 && row.tag == bookShopId) return
    row.removeAllViews()
    row.tag = bookShopId
    addShopChip(row, null, getString(R.string.blyp_shell_book_all))
    for (shop in shops) addShopChip(row, shop.id, shop.name)
  }

  private fun addShopChip(row: LinearLayout, id: String?, label: String) {
    val ctx = row.context
    val chip = TextView(ctx)
    chip.text = label
    chip.textSize = 13f
    chip.setTypeface(chip.typeface, android.graphics.Typeface.BOLD)
    val pad = (12 * resources.displayMetrics.density).toInt()
    chip.setPadding(pad, pad / 2, pad, pad / 2)
    val lp =
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    lp.marginEnd = (8 * resources.displayMetrics.density).toInt()
    chip.layoutParams = lp
    val on = bookShopId == id
    chip.setBackgroundResource(
      if (on) R.drawable.blyp_shell_summary_card_active else R.drawable.blyp_shell_summary_card,
    )
    chip.setTextColor(
      ContextCompat.getColor(ctx, if (on) R.color.blyp_shell_accent else R.color.blyp_shell_text),
    )
    chip.setOnClickListener {
      if (bookShopId == id) return@setOnClickListener
      bookShopId = id
      visibleTxLimit = HistoryListPagination.PAGE_SIZE
      reload()
    }
    row.addView(chip)
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
    val commerce = BlypShellSession.isCommerceMode(ctx)
    val shops = if (commerce) BlypShellCommerceSession.listCommerces(ctx) else emptyList()
    val picked =
      if (!commerce) {
        emptyList()
      } else if (bookShopId == null) {
        shops
      } else {
        shops.filter { it.id == bookShopId }.ifEmpty { shops }
      }
    paintBookChrome(ctx, commerce, shops)

    val totals =
      if (commerce) {
        BlypTransactionStore.bookTotals(ctx, picked.map { "$phone#${it.id}" })
      } else {
        BlypTransactionStore.computeTotals(ctx, phone)
      }
    val opCount =
      if (commerce) 0 else BlypTransactionStore.countOperations(ctx, phone)
    operationsCount = opCount

    if (commerce) {
      summaryRow?.visibility = View.VISIBLE
      summarySentValue?.text = amountFmt.format(totals.sentFcfa)
      summaryReceivedValue?.text = amountFmt.format(totals.receivedFcfa)
      updateSummarySelection()
    } else if (opCount > 0) {
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

    cachedFullItems =
      if (commerce) {
        BlypTransactionStore.loadBook(ctx, phone, picked, filter)
      } else {
        BlypTransactionStore.loadHistoryItems(ctx, phone, filter)
      }
    if (commerce) {
      val today = java.time.LocalDate.now().toString()
      var todayIn = 0
      var todayCount = 0
      for (item in cachedFullItems) {
        val row = (item as? ShellHistoryItem.Row)?.row ?: continue
        if (row.type != "received" || !row.createdAt.startsWith(today)) continue
        todayIn += row.amountFcfa
        todayCount += 1
      }
      val shopName =
        if (bookShopId == null) {
          getString(R.string.blyp_shell_book_all)
        } else {
          picked.firstOrNull()?.name.orEmpty()
        }
      subtitleView?.text =
        shopName + " · " + getString(R.string.blyp_shell_book_today, amountFmt.format(todayIn), todayCount)
    }
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
      private val motif = itemView.findViewById<TextView>(R.id.blyp_history_motif)
      private val ref = itemView.findViewById<TextView>(R.id.blyp_history_ref)
      private val amount = itemView.findViewById<TextView>(R.id.blyp_history_amount)
      private val typeChip = itemView.findViewById<TextView>(R.id.blyp_history_type_chip)

      fun bind(row: ShellHistoryRow) {
        val ctx = itemView.context
        val isReceived = row.type == "received"
        name.text = row.name
        meta.text = row.dateLabel
        val motifText = row.note?.trim().orEmpty()
        if (motifText.isEmpty()) {
          motif.visibility = View.GONE
        } else {
          motif.visibility = View.VISIBLE
          motif.text = motifText
        }
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
