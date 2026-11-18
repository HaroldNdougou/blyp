package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.Executors

class ShellReceiptsActivity : AppCompatActivity() {
  private lateinit var adapter: RouteAdapter

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_route_list)
    applySystemBarAppearance()
    findViewById<TextView>(R.id.blyp_route_title).setText(R.string.blyp_shell_receipts_title)
    findViewById<View>(R.id.blyp_route_back).setOnClickListener { finish() }
    val addBtn = findViewById<TextView>(R.id.blyp_route_action)
    addBtn.visibility = android.view.View.VISIBLE
    addBtn.setText(R.string.blyp_shell_receipts_add_rn)
    addBtn.setOnClickListener { ShellReceiptAddActivity.start(this) }
    BlypShellSession.syncReceiptsUnread(this, 0)
    BlypShellUiRefresh.notifyShellBadgesChanged()
    adapter = RouteAdapter { row -> onReceiptClick(row) }
    findViewById<RecyclerView>(R.id.blyp_route_list).apply {
      layoutManager = LinearLayoutManager(this@ShellReceiptsActivity)
      adapter = this@ShellReceiptsActivity.adapter
    }
    reload()
  }

  private fun reload() {
    val accountId = BlypShellSession.accountId(this).orEmpty()
    val items = BlypMerchantReceiptStore.list(this, accountId)
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val rows =
      items.map { r ->
        RouteRow(
          id = r.id,
          title = r.name,
          subtitle = formatSubtitle(locale, r.merchantName, r.createdAt),
          payload = r.localUri + "|" + r.contentType,
        )
      }
    adapter.submit(rows)
    val empty = findViewById<TextView>(R.id.blyp_route_empty)
    if (rows.isEmpty()) {
      empty.visibility = android.view.View.VISIBLE
      empty.setText(R.string.blyp_shell_receipts_empty)
    } else {
      empty.visibility = android.view.View.GONE
    }
  }

  private fun onReceiptClick(row: RouteRow) {
    val parts = row.payload.split("|", limit = 2)
    val localUri = parts.getOrElse(0) { "" }
    val ct = parts.getOrElse(1) { "application/pdf" }
    val file = BlypMerchantReceiptStore.resolveLocalFile(localUri)
    if (file == null) {
      Toast.makeText(this, R.string.blyp_shell_file_missing, Toast.LENGTH_SHORT).show()
      return
    }
    BlypShellFileOpener.openLocalFile(this, file, ct)
  }

  private fun formatSubtitle(locale: Locale, merchant: String?, createdAt: String): String {
    val m = merchant?.trim().orEmpty().ifEmpty { "—" }
    val date = createdAt.take(10)
    return "$m · $date"
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

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellReceiptsActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}

class ShellDocumentsActivity : AppCompatActivity() {
  private lateinit var adapter: RouteAdapter

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_route_list)
    applySystemBarAppearance()
    findViewById<TextView>(R.id.blyp_route_title).setText(R.string.blyp_shell_documents_title)
    findViewById<View>(R.id.blyp_route_back).setOnClickListener { finish() }
    findViewById<TextView>(R.id.blyp_route_action).visibility = android.view.View.GONE
    adapter = RouteAdapter { row -> onDocClick(row) }
    findViewById<RecyclerView>(R.id.blyp_route_list).apply {
      layoutManager = LinearLayoutManager(this@ShellDocumentsActivity)
      adapter = this@ShellDocumentsActivity.adapter
    }
    reload()
  }

  private fun reload() {
    findViewById<TextView>(R.id.blyp_route_empty).visibility = android.view.View.GONE
    BlypShellVaultClient.listAsync(this) { list ->
      runOnUiThread {
        if (isFinishing) return@runOnUiThread
        if (list == null) {
          Toast.makeText(this, R.string.blyp_shell_documents_sync_failed, Toast.LENGTH_SHORT)
            .show()
        }
        val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
        val fmt = NumberFormat.getIntegerInstance(locale)
        val rows =
          (list?.items ?: emptyList()).map { d ->
            val kb = (d.sizeBytes / 1024).coerceAtLeast(1)
            RouteRow(
              id = d.id,
              title = d.name,
              subtitle = "${fmt.format(kb)} Ko · ${d.createdAt.take(10)}",
              payload = d.contentType,
            )
          }
        adapter.submit(rows)
        val empty = findViewById<TextView>(R.id.blyp_route_empty)
        if (rows.isEmpty()) {
          empty.visibility = android.view.View.VISIBLE
          empty.setText(R.string.blyp_shell_documents_empty)
        } else {
          empty.visibility = android.view.View.GONE
        }
      }
    }
  }

  private fun onDocClick(row: RouteRow) {
    Toast.makeText(this, R.string.blyp_shell_opening, Toast.LENGTH_SHORT).show()
    java.util.concurrent.Executors.newSingleThreadExecutor().execute {
      val pair = BlypShellVaultClient.downloadUrlSync(this, row.id) ?: run {
        runOnUiThread {
          Toast.makeText(this, R.string.blyp_shell_documents_sync_failed, Toast.LENGTH_SHORT)
            .show()
        }
        return@execute
      }
      runOnUiThread {
        BlypShellFileOpener.openHttpUrl(this, pair.first, pair.second.ifEmpty { row.payload })
      }
    }
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

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellDocumentsActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}

class ShellKycActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_kyc)
    applySystemBarAppearance()
    findViewById<View>(R.id.blyp_kyc_back).setOnClickListener { finish() }
    val status = BlypShellSession.profile(this)?.kycStatus ?: "none"
    val banner = findViewById<TextView>(R.id.blyp_kyc_status_banner)
    val primary = findViewById<TextView>(R.id.blyp_kyc_primary)
    banner.text =
      when (status) {
        "approved" -> getString(R.string.blyp_shell_kyc_status_approved)
        "pending" -> getString(R.string.blyp_shell_kyc_status_pending)
        "rejected" -> getString(R.string.blyp_shell_kyc_status_rejected)
        else -> getString(R.string.blyp_shell_kyc_status_none)
      }
    val canFlow = status != "approved" && status != "pending"
    if (canFlow) {
      primary.visibility = android.view.View.VISIBLE
      primary.setOnClickListener { ShellKycCaptureActivity.start(this) }
    } else {
      primary.visibility = android.view.View.GONE
    }
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

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellKycActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}

private data class RouteRow(
  val id: String,
  val title: String,
  val subtitle: String,
  val payload: String,
)

private class RouteAdapter(
  private val onClick: (RouteRow) -> Unit,
) : RecyclerView.Adapter<RouteAdapter.Holder>() {
  private var items: List<RouteRow> = emptyList()

  fun submit(rows: List<RouteRow>) {
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
    holder.bind(items[position], onClick)
  }

  class Holder(itemView: View) : RecyclerView.ViewHolder(itemView) {
    private val title = itemView.findViewById<TextView>(R.id.blyp_route_row_title)
    private val sub = itemView.findViewById<TextView>(R.id.blyp_route_row_sub)

    fun bind(row: RouteRow, onClick: (RouteRow) -> Unit) {
      title.text = row.title
      sub.text = row.subtitle
      itemView.setOnClickListener { onClick(row) }
    }
  }
}
