package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.util.Locale

/** Perso ↔ commerces — PUT /me/context (sans RN). */
class ShellCommerceSwitchActivity : AppCompatActivity() {
  private var busy = false
  private lateinit var adapter: SwitchAdapter

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_commerce_switch)
    applySystemBarAppearance()
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { v, insets ->
      val top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      v.setPadding(0, top, 0, 0)
      insets
    }
    findViewById<View>(R.id.blyp_commerce_switch_back).setOnClickListener { finish() }
    val create = findViewById<TextView>(R.id.blyp_commerce_switch_create)
    lingerOutline(create)
    create.setOnClickListener {
      ShellCommerceCreateActivity.start(this)
    }
    adapter = SwitchAdapter(
      onPick = { row -> onPick(row) },
      onLongPress = { row -> onLongPressRow(row) },
    )
    findViewById<RecyclerView>(R.id.blyp_commerce_switch_list).apply {
      layoutManager = LinearLayoutManager(this@ShellCommerceSwitchActivity)
      adapter = this@ShellCommerceSwitchActivity.adapter
    }
    reload()
    BlypShellCommerceClient.refreshMeAsync(this) { ok ->
      if (ok) runOnUiThread { reload() }
    }
  }

  private fun reload() {
    val ctx = this
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val rows = ArrayList<SwitchRow>()
    val personalName = BlypShellCommerceSession.personalDisplayName(ctx)
    val personalActive = !BlypShellSession.isCommerceMode(ctx)
    rows.add(
      SwitchRow(
        key = "personal",
        title = personalName,
        subtitle = getString(R.string.blyp_shell_commerce_personal),
        balanceLabel = null,
        active = personalActive,
        personal = true,
        commerceId = null,
      ),
    )
    val activeId = BlypShellCommerceSession.activeCommerceId(ctx)
    for (c in BlypShellCommerceSession.listCommerces(ctx)) {
      rows.add(
        SwitchRow(
          key = c.id,
          title = c.name,
          subtitle = categoryLabel(c),
          balanceLabel =
            getString(
              R.string.blyp_shell_commerce_balance_chip,
              amountFmt.format(c.balanceFcfa),
            ),
          active = BlypShellSession.isCommerceMode(ctx) && c.id == activeId,
          personal = false,
          commerceId = c.id,
        ),
      )
    }
    adapter.submit(rows)
    val empty = findViewById<TextView>(R.id.blyp_commerce_switch_empty)
    empty.visibility =
      if (BlypShellCommerceSession.listCommerces(ctx).isEmpty()) View.VISIBLE else View.GONE
  }

  private fun categoryLabel(entry: ShellCommerceEntry): String =
    when (entry.category) {
      "taxi" -> getString(R.string.blyp_shell_commerce_cat_taxi)
      "shop" -> getString(R.string.blyp_shell_commerce_cat_shop)
      "street" -> getString(R.string.blyp_shell_commerce_cat_street)
      "soa_car" -> getString(R.string.blyp_shell_commerce_cat_soa)
      else -> entry.categoryLabel.ifBlank { getString(R.string.blyp_shell_commerce_cat_other) }
    }

  private fun categoryLabel(category: String): String =
    when (category) {
      "taxi" -> getString(R.string.blyp_shell_commerce_cat_taxi)
      "shop" -> getString(R.string.blyp_shell_commerce_cat_shop)
      "street" -> getString(R.string.blyp_shell_commerce_cat_street)
      "soa_car" -> getString(R.string.blyp_shell_commerce_cat_soa)
      else -> getString(R.string.blyp_shell_commerce_cat_other)
    }

  private fun onLongPressRow(row: SwitchRow) {
    if (row.personal || row.commerceId == null || busy) return
    val categories = arrayOf("taxi", "shop", "street", "other", "soa_car")
    val labels =
      categories.map { categoryLabel(it) }.toTypedArray()
    BlypShellDialogs.alertBuilder(this)
      .setTitle(getString(R.string.blyp_shell_commerce_category_picker_title, row.title))
      .setItems(labels) { _, which ->
        val cat = categories[which]
        busy = true
        findViewById<View>(R.id.blyp_commerce_switch_progress)?.visibility = View.VISIBLE
        BlypShellCommerceClient.updateCommerceCategoryAsync(
          this,
          row.commerceId,
          cat,
        ) { ok ->
          runOnUiThread {
            busy = false
            findViewById<View>(R.id.blyp_commerce_switch_progress)?.visibility = View.GONE
            if (!ok) {
              toast(getString(R.string.blyp_shell_commerce_category_failed))
              return@runOnUiThread
            }
            reload()
            ensurePayFragmentAfterCategoryChange()
          }
        }
      }
      .show()
  }

  private fun ensurePayFragmentAfterCategoryChange() {
    if (!BlypShellSession.isCommerceMode(this)) return
    val i =
      Intent(this, BlypNativeShellActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    startActivity(i)
  }

  private fun onPick(row: SwitchRow) {
    if (busy || row.active) return
    busy = true
    findViewById<View>(R.id.blyp_commerce_switch_progress)?.visibility = View.VISIBLE
    BlypShellCommerceClient.setActiveContextAsync(
      this,
      personal = row.personal,
      commerceId = row.commerceId,
    ) { ok ->
      runOnUiThread {
        busy = false
        findViewById<View>(R.id.blyp_commerce_switch_progress)?.visibility = View.GONE
        if (!ok) {
          toast(getString(R.string.blyp_shell_commerce_switch_failed))
          return@runOnUiThread
        }
        val i =
          Intent(this, BlypNativeShellActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          }
        startActivity(i)
        finish()
      }
    }
  }

  private fun lingerOutline(view: View) {
    val clear = Runnable { view.isActivated = false }
    view.setOnTouchListener { v, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          v.removeCallbacks(clear)
          v.isActivated = true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          v.removeCallbacks(clear)
          v.isActivated = true
          v.postDelayed(clear, 550)
        }
      }
      false
    }
  }

  private fun toast(msg: String) {
    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
  }

  private fun applySystemBarAppearance() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    window.setBackgroundDrawableResource(R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  private data class SwitchRow(
    val key: String,
    val title: String,
    val subtitle: String,
    val balanceLabel: String?,
    val active: Boolean,
    val personal: Boolean,
    val commerceId: String?,
  )

  private class SwitchAdapter(
    private val onPick: (SwitchRow) -> Unit,
    private val onLongPress: (SwitchRow) -> Unit,
  ) : RecyclerView.Adapter<SwitchAdapter.Holder>() {
    private var items: List<SwitchRow> = emptyList()

    fun submit(next: List<SwitchRow>) {
      items = next
      notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
      val v =
        LayoutInflater.from(parent.context)
          .inflate(R.layout.blyp_shell_commerce_switch_row, parent, false)
      return Holder(v, onPick, onLongPress)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
      holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class Holder(
      itemView: View,
      private val onPick: (SwitchRow) -> Unit,
      private val onLongPress: (SwitchRow) -> Unit,
    ) : RecyclerView.ViewHolder(itemView) {
      private val title = itemView.findViewById<TextView>(R.id.blyp_commerce_switch_row_title)
      private val subtitle = itemView.findViewById<TextView>(R.id.blyp_commerce_switch_row_sub)
      private val balance = itemView.findViewById<TextView>(R.id.blyp_commerce_switch_row_balance)
      private val active = itemView.findViewById<TextView>(R.id.blyp_commerce_switch_row_active)

      fun bind(row: SwitchRow) {
        title.text = row.title
        subtitle.text = row.subtitle
        if (row.balanceLabel.isNullOrBlank()) {
          balance.visibility = View.GONE
        } else {
          balance.visibility = View.VISIBLE
          balance.text = row.balanceLabel
        }
        active.visibility = if (row.active) View.VISIBLE else View.GONE
        itemView.alpha = if (row.active) 0.92f else 1f
        itemView.setOnClickListener {
          if (!row.active) onPick(row)
        }
        itemView.setOnLongClickListener {
          if (!row.personal) onLongPress(row)
          true
        }
      }
    }
  }

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellCommerceSwitchActivity::class.java).apply {
          if (context !is AppCompatActivity) {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        },
      )
    }
  }
}
