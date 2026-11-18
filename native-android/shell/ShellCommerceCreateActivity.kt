package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R

/** Création commerce — POST /commerces (sans React). */
class ShellCommerceCreateActivity : AppCompatActivity() {
  private var category = "taxi"
  private var busy = false
  private lateinit var chipTaxi: TextView
  private lateinit var chipSoa: TextView
  private lateinit var errorView: TextView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_commerce_create)
    applySystemBarAppearance()
    val scroll = findViewById<View>(R.id.blyp_commerce_create_scroll)
    ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val floor = (56 * v.resources.displayMetrics.density).toInt()
      val bottom = if (ime.bottom > 0) ime.bottom else maxOf(bars.bottom, floor)
      v.setPadding(v.paddingLeft, bars.top, v.paddingRight, bottom)
      insets
    }
    findViewById<View>(R.id.blyp_commerce_create_arrow).setOnClickListener { finish() }
    findViewById<TextView>(R.id.blyp_commerce_create_back).setOnClickListener { finish() }
    chipTaxi = findViewById(R.id.blyp_commerce_create_cat_taxi)
    chipSoa = findViewById(R.id.blyp_commerce_create_cat_soa)
    errorView = findViewById(R.id.blyp_commerce_create_error)
    chipTaxi.setOnClickListener { selectCategory("taxi") }
    chipSoa.setOnClickListener { selectCategory("soa_car") }
    selectCategory("taxi")
    findViewById<TextView>(R.id.blyp_commerce_create_submit).setOnClickListener {
      submit(findViewById(R.id.blyp_commerce_create_name))
    }
  }

  private fun selectCategory(next: String) {
    category = next
    styleChip(chipTaxi, next == "taxi")
    styleChip(chipSoa, next == "soa_car")
  }

  private fun styleChip(view: TextView, selected: Boolean) {
    if (selected) {
      view.setBackgroundResource(R.drawable.blyp_shell_commerce_chip_on)
      view.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_accent))
    } else {
      view.setBackgroundResource(R.drawable.blyp_shell_filter_chip)
      view.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_text))
    }
  }

  private fun submit(nameInput: EditText) {
    if (busy) return
    val name = capitalizeCommerceName(nameInput.text.toString())
    nameInput.setText(name)
    if (name.trim().length < 2) {
      showError(getString(R.string.blyp_shell_commerce_create_name_short))
      return
    }
    val typeName = ""
    hideError()
    busy = true
    findViewById<TextView>(R.id.blyp_commerce_create_submit).alpha = 0.55f
    BlypButtonSpinner.show(findViewById(R.id.blyp_commerce_create_submit))
    findViewById<android.view.View>(R.id.blyp_commerce_create_progress).visibility =
      android.view.View.VISIBLE
    BlypShellCommerceClient.createCommerceAsync(this, name, category, typeName) { result ->
      runOnUiThread {
        busy = false
        findViewById<TextView>(R.id.blyp_commerce_create_submit).alpha = 1f
        BlypButtonSpinner.hide(findViewById(R.id.blyp_commerce_create_submit))
        findViewById<android.view.View>(R.id.blyp_commerce_create_progress).visibility =
          android.view.View.GONE
        if (!result.ok) {
          val msg =
            when (result.message) {
              "NAME_TOO_SHORT" -> getString(R.string.blyp_shell_commerce_create_name_short)
              null -> getString(R.string.blyp_shell_commerce_create_failed)
              else -> result.message
            }
          showError(msg)
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

  private fun capitalizeCommerceName(raw: String): String {
    return raw.trim().replace(Regex("\\s+"), " ").replace(Regex("\\S+")) { m ->
      val w = m.value
      w.first().uppercaseChar().toString() + w.drop(1)
    }
  }

  private fun showError(msg: String) {
    errorView.text = msg
    errorView.visibility = android.view.View.VISIBLE
  }

  private fun hideError() {
    errorView.visibility = android.view.View.GONE
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

  companion object {
    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellCommerceCreateActivity::class.java).apply {
          if (context !is AppCompatActivity) {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        },
      )
    }
  }
}
