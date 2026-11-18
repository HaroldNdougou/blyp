package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Accueil mode pro natif — recette du jour + encaissements récents (cache SQLite). */
class CommerceShellFragment : Fragment() {
  private var unsubRefresh: (() -> Unit)? = null
  private var unsubBroadcast: (() -> Unit)? = null
  private var unsubFlash: (() -> Unit)? = null
  private var todayValue: TextView? = null
  private var emptyRecent: TextView? = null
  private var recentCard: View? = null
  private var recentList: RecyclerView? = null
  private var footerMeta: TextView? = null
  private var onlineLabel: TextView? = null
  private var onlineSwitch: SwitchCompat? = null
  private var onlineRow: View? = null
  private var swipe: androidx.swiperefreshlayout.widget.SwipeRefreshLayout? = null
  private var flashOverlay: View? = null
  private var flashAmount: TextView? = null
  private var meRefreshScheduled = false
  private var focused = false
  private val flashHandler = Handler(Looper.getMainLooper())
  private var flashDismissRunnable: Runnable? = null

  private val blePermLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
      val ctx = context ?: return@registerForActivityResult
      if (BlypShellTaxiBroadcast.hasAdvertisePermission(ctx)) {
        BlypShellTaxiBroadcast.setWantOn(ctx, true)
      }
      bindOnline()
    }

  private val recentAdapter =
    object : RecyclerView.Adapter<RecentHolder>() {
      var rows: List<ShellHistoryRow> = emptyList()
        set(value) {
          field = value
          notifyDataSetChanged()
        }

      override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecentHolder {
        val v =
          LayoutInflater.from(parent.context)
            .inflate(R.layout.blyp_shell_commerce_recent_row, parent, false)
        return RecentHolder(v)
      }

      override fun onBindViewHolder(holder: RecentHolder, position: Int) {
        holder.bind(rows[position])
      }

      override fun getItemCount(): Int = rows.size
    }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_shell_commerce_home, container, false)
    todayValue = root.findViewById(R.id.blyp_commerce_today_amount)
    emptyRecent = root.findViewById(R.id.blyp_commerce_recent_empty)
    recentCard = root.findViewById(R.id.blyp_commerce_recent_card)
    recentList = root.findViewById(R.id.blyp_commerce_recent_list)
    footerMeta = root.findViewById(R.id.blyp_commerce_footer)
    onlineLabel = root.findViewById(R.id.blyp_commerce_online_label)
    onlineSwitch = root.findViewById(R.id.blyp_commerce_online_switch)
    onlineRow = root.findViewById(R.id.blyp_commerce_online_row)
    swipe = root.findViewById(R.id.blyp_commerce_swipe)
    swipe?.setColorSchemeResources(R.color.blyp_shell_accent)
    swipe?.setProgressBackgroundColorSchemeResource(R.color.blyp_shell_surface)
    swipe?.setOnRefreshListener { pullToRefresh() }
    flashOverlay = root.findViewById(R.id.blyp_commerce_flash_overlay)
    flashAmount = root.findViewById(R.id.blyp_commerce_flash_amount)
    recentList?.layoutManager = LinearLayoutManager(requireContext())
    recentList?.adapter = recentAdapter
    onlineRow?.setOnClickListener { onOnlineToggleRequested() }
    root.findViewById<View>(R.id.blyp_commerce_withdraw)?.setOnClickListener {
      BlypShellDialogs.alertBuilder(requireContext())
        .setTitle(R.string.blyp_shell_profile_withdraw_title)
        .setMessage(R.string.blyp_shell_profile_withdraw_soon)
        .setPositiveButton(android.R.string.ok, null)
        .show()
    }
    root.findViewById<View>(R.id.blyp_commerce_qr_cta)?.setOnClickListener {
      ShellMerchantQrActivity.start(requireContext())
    }
    flashOverlay?.setOnClickListener { dismissFlash() }
    return root
  }

  override fun onStart() {
    super.onStart()
    unsubRefresh = BlypShellUiRefresh.subscribe { bindCommerce() }
    unsubBroadcast = BlypShellTaxiBroadcast.subscribe { bindOnline() }
  }

  override fun onStop() {
    unsubRefresh?.invoke()
    unsubRefresh = null
    unsubBroadcast?.invoke()
    unsubBroadcast = null
    unsubFlash?.invoke()
    unsubFlash = null
    dismissFlash()
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    BlypShellPerfMarks.end("commerce_open")
    focused = true
    bindCommerce()
    bindOnline()
    context?.let { BlypShellClosedCashier.syncForCommerceScreen(it) }
    maybeRefreshMeOnce()
    scheduleDeltaSync()
    unsubFlash?.invoke()
    unsubFlash =
      BlypShellIncomingFlash.subscribe { event ->
        if (!focused) return@subscribe
        activity?.runOnUiThread { showFlash(event.amountFcfa) }
      }
  }

  override fun onPause() {
    focused = false
    super.onPause()
  }

  override fun onDestroyView() {
    context?.let { BlypShellClosedCashier.onScreenGone(it) }
    super.onDestroyView()
  }

  private fun onOnlineToggleRequested() {
    val ctx = context ?: return
    val snap = BlypShellTaxiBroadcast.snapshot(ctx)
    if (snap.busy) return
    applyOnlineToggle(!snap.wantOn)
  }

  private fun applyOnlineToggle(next: Boolean) {
    val ctx = context ?: return
    if (next && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val perms =
        arrayOf(
          Manifest.permission.BLUETOOTH_ADVERTISE,
          Manifest.permission.BLUETOOTH_CONNECT,
        )
      val missing = perms.any {
        ContextCompat.checkSelfPermission(ctx, it) != PackageManager.PERMISSION_GRANTED
      }
      if (missing) {
        blePermLauncher.launch(perms)
        return
      }
    }
    BlypShellTaxiBroadcast.setWantOn(ctx, next)
    bindOnline()
  }

  private fun bindOnline() {
    val ctx = context ?: return
    val snap = BlypShellTaxiBroadcast.snapshot(ctx)
    onlineSwitch?.isChecked = snap.wantOn
    onlineSwitch?.isEnabled = !snap.busy
    onlineRow?.alpha = if (snap.busy) 0.55f else 1f
    val label =
      when {
        snap.busy -> getString(R.string.blyp_shell_commerce_online_reconnecting)
        snap.wantOn && snap.on -> getString(R.string.blyp_shell_commerce_online_on)
        snap.wantOn && snap.interrupted ->
          getString(R.string.blyp_shell_commerce_online_reconnecting)
        snap.wantOn -> getString(R.string.blyp_shell_commerce_online_reconnecting)
        else -> getString(R.string.blyp_shell_commerce_online_off)
      }
    onlineLabel?.text = label
    val accent = ContextCompat.getColor(ctx, R.color.blyp_shell_accent)
    val muted = ContextCompat.getColor(ctx, R.color.blyp_shell_muted)
    onlineLabel?.setTextColor(if (snap.wantOn && snap.on) accent else muted)
  }

  private fun showFlash(amountFcfa: Int) {
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    flashAmount?.text = "+ ${amountFmt.format(amountFcfa)}"
    flashOverlay?.visibility = View.VISIBLE
    bindCommerce()
    flashDismissRunnable?.let { flashHandler.removeCallbacks(it) }
    val dismiss =
      Runnable {
        dismissFlash()
      }
    flashDismissRunnable = dismiss
    flashHandler.postDelayed(dismiss, FLASH_MS)
  }

  private fun dismissFlash() {
    flashDismissRunnable?.let { flashHandler.removeCallbacks(it) }
    flashDismissRunnable = null
    flashOverlay?.visibility = View.GONE
  }

  private fun maybeRefreshMeOnce() {
    if (meRefreshScheduled) return
    val ctx = context ?: return
    if (BlypShellCommerceSession.hasAnyCommerce(ctx)) return
    meRefreshScheduled = true
    BlypShellCommerceClient.refreshMeAsync(ctx) { ok ->
      activity?.runOnUiThread {
        if (ok) bindCommerce()
      }
    }
  }

  /** Tirer vers le bas : solde et encaissements du serveur, sans attendre. */
  private fun pullToRefresh() {
    val ctx = context ?: run {
      swipe?.isRefreshing = false
      return
    }
    val phone = BlypShellSession.phone(ctx)?.trim().orEmpty()
    var pending = if (phone.isEmpty()) 1 else 2
    val done = {
      activity?.runOnUiThread {
        pending -= 1
        if (pending <= 0) {
          swipe?.isRefreshing = false
          bindCommerce()
        }
      }
      Unit
    }
    BlypShellCommerceClient.refreshMeAsync(ctx.applicationContext) { _ -> done() }
    if (phone.isNotEmpty()) {
      BlypHistoryDeltaSync.syncAfterUserPull(ctx.applicationContext, phone) { _ -> done() }
    }
  }

  private fun scheduleDeltaSync() {
    val ctx = context ?: return
    val phone = BlypShellSession.phone(ctx)?.trim().orEmpty()
    if (phone.isEmpty()) return
    BlypHistoryDeltaSync.scheduleAfterHistoryPaint(ctx, phone) {
      activity?.runOnUiThread { bindCommerce() }
    }
  }

  private fun bindCommerce() {
    val ctx = context ?: return
    val phone = BlypShellSession.phone(ctx)?.trim().orEmpty()
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val dayKey = BlypShellCommerceDay.todayKey()
    val todaySum =
      if (phone.isEmpty()) 0 else BlypTransactionStore.sumReceivedForDay(ctx, phone, dayKey)
    val recent =
      if (phone.isEmpty()) {
        emptyList()
      } else {
        BlypTransactionStore.listReceivedForDay(ctx, phone, dayKey, RECENT_MAX)
      }
    todayValue?.text = amountFmt.format(todaySum)
    val name = BlypShellCommerceSession.activeCommerceName(ctx)
    footerMeta?.text = getString(R.string.blyp_shell_commerce_footer, name)
    if (recent.isEmpty()) {
      emptyRecent?.visibility = View.VISIBLE
      recentCard?.visibility = View.GONE
    } else {
      emptyRecent?.visibility = View.GONE
      recentCard?.visibility = View.VISIBLE
      recentAdapter.rows = recent
    }
  }

  private class RecentHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
    private val amount = itemView.findViewById<TextView>(R.id.blyp_commerce_recent_amount)
    private val name = itemView.findViewById<TextView>(R.id.blyp_commerce_recent_name)
    private val whenView = itemView.findViewById<TextView>(R.id.blyp_commerce_recent_when)

    fun bind(row: ShellHistoryRow) {
      amount.text = "+ ${row.amountLabel}"
      name.text = row.name
      whenView.text = row.dateLabel
    }
  }

  companion object {
    private const val RECENT_MAX = 5
    private const val FLASH_MS = 10_000L
  }
}
