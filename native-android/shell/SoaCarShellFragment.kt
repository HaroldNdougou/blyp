package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Accueil Car Soa natif — grille sièges + course active. */
class SoaCarShellFragment : Fragment() {
  private val seatRows: Array<IntArray> =
    arrayOf(
      intArrayOf(0, 0, 1, 2),
      intArrayOf(3, 4, 5, 6),
      intArrayOf(7, 8, 9, 10),
      intArrayOf(11, 12, 13, 14),
      intArrayOf(15, 16, 17, 18),
    )
  private var unsubRefresh: (() -> Unit)? = null
  private var unsubBroadcast: (() -> Unit)? = null
  private var unsubFlash: (() -> Unit)? = null
  private var seatGrid: LinearLayout? = null
  private var tripTotalView: TextView? = null
  private var footerView: TextView? = null
  private var onlineLabel: TextView? = null
  private var onlineSwitch: SwitchCompat? = null
  private var onlineRow: View? = null
  private var flashOverlay: View? = null
  private var flashAmount: TextView? = null
  private var focused = false
  private var trip: ShellSoaCarTrip? = null
  private val pollHandler = Handler(Looper.getMainLooper())
  private val flashHandler = Handler(Looper.getMainLooper())
  private var flashDismissRunnable: Runnable? = null
  private var resetting = false
  private var exportingReport = false

  private val pollRunnable =
    object : Runnable {
      override fun run() {
        if (!focused) return
        refreshTrip()
        pollHandler.postDelayed(this, POLL_MS)
      }
    }

  private val blePermLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
      val ctx = context ?: return@registerForActivityResult
      if (BlypShellTaxiBroadcast.hasAdvertisePermission(ctx)) {
        BlypShellTaxiBroadcast.setWantOn(ctx, true)
      }
      bindOnline()
    }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_shell_soa_car_home, container, false)
    seatGrid = root.findViewById(R.id.blyp_soa_seat_grid)
    tripTotalView = root.findViewById(R.id.blyp_soa_trip_total)
    footerView = root.findViewById(R.id.blyp_soa_footer)
    onlineLabel = root.findViewById(R.id.blyp_soa_online_label)
    onlineSwitch = root.findViewById(R.id.blyp_soa_online_switch)
    onlineRow = root.findViewById(R.id.blyp_soa_online_row)
    flashOverlay = root.findViewById(R.id.blyp_soa_flash_overlay)
    flashAmount = root.findViewById(R.id.blyp_soa_flash_amount)
    onlineRow?.setOnClickListener { onOnlineToggleRequested() }
    root.findViewById<View>(R.id.blyp_soa_withdraw)?.setOnClickListener {
      BlypShellDialogs.alertBuilder(requireContext())
        .setTitle(R.string.blyp_shell_profile_withdraw_title)
        .setMessage(R.string.blyp_shell_profile_withdraw_soon)
        .setPositiveButton(android.R.string.ok, null)
        .show()
    }
    flashOverlay?.setOnClickListener { dismissFlash() }
    root.findViewById<TextView>(R.id.blyp_soa_new_trip).setOnClickListener {
      confirmNewTrip()
    }
    root.findViewById<TextView>(R.id.blyp_soa_export_report).setOnClickListener {
      exportDayReport()
    }
    root.findViewById<TextView>(R.id.blyp_soa_period_report).setOnClickListener {
      ShellSoaReportActivity.start(requireContext())
    }
    buildSeatGridShell()
    return root
  }

  override fun onStart() {
    super.onStart()
    unsubRefresh = BlypShellUiRefresh.subscribe { bindTripUi() }
    unsubBroadcast = BlypShellTaxiBroadcast.subscribe { bindOnline() }
  }

  override fun onStop() {
    unsubRefresh?.invoke()
    unsubRefresh = null
    unsubBroadcast?.invoke()
    unsubBroadcast = null
    unsubFlash?.invoke()
    unsubFlash = null
    pollHandler.removeCallbacks(pollRunnable)
    dismissFlash()
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    focused = true
    BlypShellPerfMarks.end("soa_car_open")
    bindOnline()
    refreshTrip()
    pollHandler.removeCallbacks(pollRunnable)
    pollHandler.postDelayed(pollRunnable, POLL_MS)
    unsubFlash?.invoke()
    unsubFlash =
      BlypShellIncomingFlash.subscribe {
        if (!focused) return@subscribe
        activity?.runOnUiThread {
          showFlash(it.amountFcfa)
          refreshTrip()
        }
      }
  }

  override fun onPause() {
    focused = false
    pollHandler.removeCallbacks(pollRunnable)
    super.onPause()
  }

  private fun buildSeatGridShell() {
    val grid = seatGrid ?: return
    grid.removeAllViews()
    val ctx = requireContext()
    val dp = ctx.resources.displayMetrics.density
    val pad = (4 * dp).toInt()
    for (row in seatRows) {
      val rowLayout =
        LinearLayout(ctx).apply {
          orientation = LinearLayout.HORIZONTAL
          layoutParams =
            LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT,
              ViewGroup.LayoutParams.WRAP_CONTENT,
            )
        }
      for (seat in row) {
        val cell =
          TextView(ctx).apply {
            layoutParams =
              LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(pad, pad, pad, pad)
              }
            gravity = Gravity.CENTER
            setPadding(pad, pad * 2, pad, pad * 2)
            textSize = 13f
            setBackgroundResource(R.drawable.blyp_shell_filter_chip)
            if (seat == 0) {
              visibility = View.INVISIBLE
            } else {
              tag = seat
            }
          }
        rowLayout.addView(cell)
      }
      grid.addView(rowLayout)
    }
  }

  private fun refreshTrip() {
    val ctx = context ?: return
    val commerceId = BlypShellCommerceSession.activeCommerceId(ctx) ?: return
    BlypShellSoaTripClient.fetchTripAsync(ctx, commerceId) { next ->
      activity?.runOnUiThread {
        if (next != null) {
          trip = next
          bindTripUi()
        }
      }
    }
  }

  private fun bindTripUi() {
    val ctx = context ?: return
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val t = trip
    tripTotalView?.text =
      amountFmt.format(t?.totalFcfa ?: 0) + " " + getString(R.string.blyp_shell_history_fcfa)
    footerView?.text =
      getString(
        R.string.blyp_shell_commerce_footer,
        BlypShellCommerceSession.activeCommerceName(ctx),
      )
    val agg = BlypShellSoaSeatAgg.buildMap(t?.seats ?: emptyList())
    val grid = seatGrid ?: return
    for (i in 0 until grid.childCount) {
      val row = grid.getChildAt(i) as? LinearLayout ?: continue
      for (j in 0 until row.childCount) {
        val cell = row.getChildAt(j) as? TextView ?: continue
        val seat = cell.tag as? Int ?: continue
        val a = agg[seat]
        if (a != null && a.paymentCount > 0) {
          cell.setBackgroundResource(R.drawable.blyp_shell_filter_chip_selected)
          cell.setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_accent_on))
          cell.text = "$seat\n${amountFmt.format(a.totalFcfa)}"
          cell.setTypeface(null, Typeface.BOLD)
          cell.setOnClickListener { showSeatDetail(seat) }
        } else {
          cell.setBackgroundResource(R.drawable.blyp_shell_filter_chip)
          cell.setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_text))
          cell.text = seat.toString()
          cell.setTypeface(null, Typeface.NORMAL)
          cell.setOnClickListener(null)
        }
      }
    }
  }

  private fun confirmNewTrip() {
    if (resetting) return
    val ctx = context ?: return
    BlypShellDialogs.alertBuilder(ctx)
      .setTitle(R.string.blyp_shell_soa_new_trip_title)
      .setMessage(R.string.blyp_shell_soa_new_trip_message)
      .setNegativeButton(R.string.blyp_shell_sign_out_cancel, null)
      .setPositiveButton(R.string.blyp_shell_soa_new_trip_confirm) { _, _ -> resetTrip() }
      .show()
  }

  private fun resetTrip() {
    val ctx = context ?: return
    val commerceId = BlypShellCommerceSession.activeCommerceId(ctx) ?: return
    resetting = true
    val btn = view?.findViewById<View>(R.id.blyp_soa_new_trip)
    BlypButtonSpinner.show(btn)
    BlypShellSoaTripClient.resetTripAsync(ctx, commerceId) { next ->
      activity?.runOnUiThread {
        resetting = false
        BlypButtonSpinner.hide(btn)
        if (next != null) {
          trip = next
          bindTripUi()
        }
      }
    }
  }

  private fun onOnlineToggleRequested() {
    val ctx = context ?: return
    val snap = BlypShellTaxiBroadcast.snapshot(ctx)
    if (snap.busy) return
    val next = !snap.wantOn
    if (next && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val perms =
        arrayOf(
          Manifest.permission.BLUETOOTH_ADVERTISE,
          Manifest.permission.BLUETOOTH_CONNECT,
        )
      val missing =
        perms.any {
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
    flashDismissRunnable?.let { flashHandler.removeCallbacks(it) }
    val dismiss = Runnable { dismissFlash() }
    flashDismissRunnable = dismiss
    flashHandler.postDelayed(dismiss, FLASH_MS)
  }

  private fun dismissFlash() {
    flashDismissRunnable?.let { flashHandler.removeCallbacks(it) }
    flashDismissRunnable = null
    flashOverlay?.visibility = View.GONE
  }

  private fun exportDayReport() {
    if (exportingReport) return
    val ctx = context ?: return
    val commerceId = BlypShellCommerceSession.activeCommerceId(ctx) ?: return
    val commerceName = BlypShellCommerceSession.activeCommerceName(ctx)
    val dayKey = BlypShellSoaDayKey.todayKey()
    exportingReport = true
    val btn = view?.findViewById<View>(R.id.blyp_soa_export_report)
    BlypButtonSpinner.show(btn)
    BlypShellSoaDayReportClient.fetchDayReportAsync(ctx, commerceId, dayKey) { report ->
      activity?.runOnUiThread {
        exportingReport = false
        BlypButtonSpinner.hide(btn)
        if (report == null) {
          BlypShellDialogs.alertBuilder(ctx)
            .setMessage(R.string.blyp_shell_soa_export_failed)
            .setPositiveButton(android.R.string.ok, null)
            .show()
          return@runOnUiThread
        }
        val text =
          BlypShellSoaReportExport.buildPlainText(ctx, commerceName, report)
        val csv = BlypShellSoaReportExport.writeCsvFile(ctx, report, commerceId)
        val title = ctx.getString(R.string.blyp_shell_soa_report_title)
        BlypShellShare.shareTextAndOptionalFile(
          ctx,
          title,
          text,
          csv,
          "text/csv",
        )
      }
    }
  }

  private fun showSeatDetail(seat: Int) {
    val ctx = context ?: return
    val t = trip ?: return
    val payments =
      t.seats
        .filter { it.seatNumber == seat }
        .sortedByDescending { it.paidAt }
    if (payments.isEmpty()) return
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val total = payments.sumOf { it.amountFcfa }
    val header =
      getString(
        R.string.blyp_shell_soa_seat_payment_count,
        payments.size,
        amountFmt.format(total),
      )
    val lines =
      payments.joinToString("\n") { p ->
        val who = p.payerName?.trim().orEmpty().ifEmpty { "—" }
        val whenLabel = BlypShellCommerceDay.localDateTimeLabel(p.paidAt)
        getString(
          R.string.blyp_shell_soa_seat_payment_line,
          who,
          amountFmt.format(p.amountFcfa),
        ) + "\n  $whenLabel"
      }
    BlypShellDialogs.alertBuilder(ctx)
      .setTitle(getString(R.string.blyp_shell_soa_seat_detail_title, seat))
      .setMessage("$header\n\n$lines")
      .setPositiveButton(R.string.blyp_shell_detail_close, null)
      .show()
  }

  companion object {
    private const val POLL_MS = 4_000L
    private const val FLASH_MS = 10_000L
  }
}
