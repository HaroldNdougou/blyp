package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Compte rendu Soa jour / semaine / mois + export + liste courses. */
class ShellSoaReportActivity : AppCompatActivity() {
  private var kind: BlypShellSoaPeriod.Kind = BlypShellSoaPeriod.Kind.DAY
  private var periodKey: String = BlypShellSoaPeriod.todayKey()
  private var loading = false
  private var report: ShellSoaDayReport? = null
  private var tripRows: List<BlypShellSoaReportExport.OrderedTrip> = emptyList()

  private val tripAdapter =
    object : RecyclerView.Adapter<TripHolder>() {
      override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TripHolder {
        val v =
          LayoutInflater.from(parent.context)
            .inflate(R.layout.blyp_shell_soa_report_trip_row, parent, false)
        return TripHolder(v)
      }

      override fun onBindViewHolder(holder: TripHolder, position: Int) {
        val row = tripRows[position]
        holder.bind(this@ShellSoaReportActivity, row) { showTripDetail(row) }
      }

      override fun getItemCount(): Int = tripRows.size
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_soa_report)
    applySystemBarAppearance()
    findViewById<View>(R.id.blyp_soa_report_close).setOnClickListener { finish() }
    findViewById<RecyclerView>(R.id.blyp_soa_report_trip_list).apply {
      layoutManager = LinearLayoutManager(this@ShellSoaReportActivity)
      adapter = tripAdapter
    }
    bindKindSpinner()
    bindPeriodSpinner()
    findViewById<TextView>(R.id.blyp_soa_report_export_text).setOnClickListener {
      shareTextReport()
    }
    findViewById<TextView>(R.id.blyp_soa_report_export_csv).setOnClickListener {
      shareCsvReport()
    }
    loadReport()
  }

  private fun bindKindSpinner() {
    val spinner = findViewById<Spinner>(R.id.blyp_soa_report_kind)
    val labels =
      listOf(
        getString(R.string.blyp_shell_soa_report_period_day),
        getString(R.string.blyp_shell_soa_report_period_week),
        getString(R.string.blyp_shell_soa_report_period_month),
      )
    spinner.adapter =
      ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
    spinner.onItemSelectedListener =
      object : AdapterView.OnItemSelectedListener {
        override fun onItemSelected(
          parent: AdapterView<*>?,
          view: View?,
          position: Int,
          id: Long,
        ) {
          kind =
            when (position) {
              1 -> BlypShellSoaPeriod.Kind.WEEK
              2 -> BlypShellSoaPeriod.Kind.MONTH
              else -> BlypShellSoaPeriod.Kind.DAY
            }
          bindPeriodSpinner()
          loadReport()
        }

        override fun onNothingSelected(parent: AdapterView<*>?) {}
      }
  }

  private fun bindPeriodSpinner() {
    val spinner = findViewById<Spinner>(R.id.blyp_soa_report_period)
    val keys =
      when (kind) {
        BlypShellSoaPeriod.Kind.DAY -> BlypShellSoaPeriod.recentDayKeys()
        BlypShellSoaPeriod.Kind.WEEK -> BlypShellSoaPeriod.recentWeekStarts()
        BlypShellSoaPeriod.Kind.MONTH -> BlypShellSoaPeriod.recentMonthKeys()
      }
    val labels =
      keys.map { BlypShellSoaPeriod.formatPeriodLabel(this, kind, it) }
    spinner.adapter =
      ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
    periodKey = keys.firstOrNull() ?: BlypShellSoaPeriod.todayKey()
    spinner.onItemSelectedListener =
      object : AdapterView.OnItemSelectedListener {
        override fun onItemSelected(
          parent: AdapterView<*>?,
          view: View?,
          position: Int,
          id: Long,
        ) {
          periodKey = keys.getOrElse(position) { periodKey }
          loadReport()
        }

        override fun onNothingSelected(parent: AdapterView<*>?) {}
      }
  }

  private fun loadReport() {
    if (loading) return
    val commerceId = BlypShellCommerceSession.activeCommerceId(this) ?: return
    loading = true
    report = null
    tripRows = emptyList()
    tripAdapter.notifyDataSetChanged()
    findViewById<TextView>(R.id.blyp_soa_report_summary).text =
      getString(R.string.blyp_shell_soa_report_loading)
    val dayKeys = BlypShellSoaPeriod.dayKeysForKind(kind, periodKey)
    BlypShellSoaDayReportClient.fetchAggregatedReportAsync(
      this,
      commerceId,
      periodKey,
      dayKeys,
    ) { res ->
      runOnUiThread {
        loading = false
        report = res
        bindSummary(res)
        bindTripList(res)
      }
    }
  }

  private fun bindSummary(res: ShellSoaDayReport?) {
    val summary = findViewById<TextView>(R.id.blyp_soa_report_summary)
    if (res == null) {
      summary.text = getString(R.string.blyp_shell_soa_export_failed)
      return
    }
    val loc = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amount = NumberFormat.getIntegerInstance(loc).format(res.totalFcfa.coerceAtLeast(0))
    val completed = res.trips.count { !it.isActive }
    summary.text =
      getString(
        R.string.blyp_shell_soa_report_period_summary,
        BlypShellSoaPeriod.formatPeriodLabel(this, kind, periodKey),
        amount,
        completed,
      )
  }

  private fun bindTripList(res: ShellSoaDayReport?) {
    tripRows =
      if (res == null) {
        emptyList()
      } else {
        BlypShellSoaReportExport.orderTrips(res.trips)
      }
    tripAdapter.notifyDataSetChanged()
  }

  private fun showTripDetail(row: BlypShellSoaReportExport.OrderedTrip) {
    val loc = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(loc)
    val title =
      when {
        row.trip.isActive -> getString(R.string.blyp_shell_soa_report_trip_detail_active)
        row.courseNumber != null ->
          getString(R.string.blyp_shell_soa_report_trip_n, row.courseNumber)
        else -> getString(R.string.blyp_shell_soa_report_trip_line)
      }
    val started = formatIsoShort(row.trip.tripStartedAt)
    val ended =
      row.trip.endedAt?.let { formatIsoShort(it) }
        ?: getString(R.string.blyp_shell_soa_report_trip_detail_no_end)
    val body =
      getString(
        R.string.blyp_shell_soa_report_trip_detail_body,
        title,
        amountFmt.format(row.trip.totalFcfa.coerceAtLeast(0)),
        started,
        ended,
      )
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_soa_report_trip_detail_title)
      .setMessage(body)
      .setPositiveButton(R.string.blyp_shell_detail_close, null)
      .show()
  }

  private fun formatIsoShort(iso: String): String {
    return BlypShellCommerceDay.localDateTimeLabel(iso)
  }

  private fun shareTextReport() {
    val r = report ?: return
    val name = BlypShellCommerceSession.activeCommerceName(this)
    val text = BlypShellSoaReportExport.buildPlainText(this, name, r)
    BlypShellShare.shareTextAndOptionalFile(
      this,
      getString(R.string.blyp_shell_soa_report_title),
      text,
      null,
      "text/plain",
    )
  }

  private fun shareCsvReport() {
    val r = report ?: return
    val commerceId = BlypShellCommerceSession.activeCommerceId(this) ?: return
    val file = BlypShellSoaReportExport.writeCsvFile(this, r, commerceId) ?: return
    val text =
      BlypShellSoaReportExport.buildPlainText(
        this,
        BlypShellCommerceSession.activeCommerceName(this),
        r,
      )
    BlypShellShare.shareTextAndOptionalFile(
      this,
      getString(R.string.blyp_shell_soa_report_title),
      text,
      file,
      "text/csv",
    )
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

  private class TripHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
    private val title = itemView.findViewById<TextView>(R.id.blyp_soa_report_trip_title)
    private val sub = itemView.findViewById<TextView>(R.id.blyp_soa_report_trip_sub)

    fun bind(
      activity: ShellSoaReportActivity,
      row: BlypShellSoaReportExport.OrderedTrip,
      onClick: () -> Unit,
    ) {
      val loc = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
      val amountFmt = NumberFormat.getIntegerInstance(loc)
      val titleText =
        when {
          row.trip.isActive -> activity.getString(R.string.blyp_shell_soa_report_trip_active)
          row.courseNumber != null ->
            activity.getString(R.string.blyp_shell_soa_report_trip_n, row.courseNumber)
          else -> activity.getString(R.string.blyp_shell_soa_report_trip_line)
        }
      title.text = titleText
      sub.text =
        "${amountFmt.format(row.trip.totalFcfa.coerceAtLeast(0))} ${activity.getString(R.string.blyp_shell_history_fcfa)} · ${activity.formatIsoShort(row.trip.tripStartedAt)}"
      itemView.setOnClickListener { onClick() }
    }
  }

  companion object {
    fun start(context: Context) {
      context.startActivity(Intent(context, ShellSoaReportActivity::class.java))
    }
  }
}
