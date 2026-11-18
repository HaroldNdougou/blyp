package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.haroldndougou.blyp.R

/** QR du commerce — calqué sur `app/pay-qr.tsx` + montant + luminosité. */
class ShellMerchantQrActivity : AppCompatActivity() {
  private var savedBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.blyp_shell_merchant_qr)
    findViewById<View>(android.R.id.content).apply {
      isFocusable = true
      isFocusableInTouchMode = true
    }
    applyBars()
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    savedBrightness = window.attributes.screenBrightness
    applyBrightness(0.1f)
    findViewById<View>(R.id.blyp_merchant_qr_back).setOnClickListener { finish() }
    findViewById<TextView>(R.id.blyp_merchant_qr_close).setOnClickListener { finish() }
    findViewById<SeekBar>(R.id.blyp_merchant_qr_brightness).setOnSeekBarChangeListener(
      object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          applyBrightness((progress.coerceIn(0, 100)) / 100f)
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) {}
        override fun onStopTrackingTouch(seekBar: SeekBar?) {}
      },
    )
    val amount = findViewById<EditText>(R.id.blyp_merchant_qr_amount)
    amount.setOnFocusChangeListener { view, hasFocus ->
      (view as EditText).isCursorVisible = hasFocus
    }
    amount.setOnEditorActionListener { view, actionId, event ->
      val done =
        actionId == EditorInfo.IME_ACTION_DONE ||
          (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
      if (!done) return@setOnEditorActionListener false
      hideAmountCursor(view)
      true
    }
    amount.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          renderQr()
        }
      },
    )
    renderQr()
  }

  override fun onDestroy() {
    val lp = window.attributes
    lp.screenBrightness = savedBrightness
    window.attributes = lp
    super.onDestroy()
  }

  private fun hideAmountCursor(view: View) {
    if (view is EditText) view.isCursorVisible = false
    getSystemService(InputMethodManager::class.java)
      ?.hideSoftInputFromWindow(view.windowToken, 0)
    view.clearFocus()
  }

  private fun applyBrightness(value: Float) {
    val lp = window.attributes
    lp.screenBrightness = value.coerceIn(0.05f, 1f)
    window.attributes = lp
  }

  private fun renderQr() {
    val acc = BlypShellBleAccount.resolveCommerce(this)
    val img = findViewById<ImageView>(R.id.blyp_merchant_qr_image)
    if (acc == null) {
      img.visibility = android.view.View.GONE
      return
    }
    val raw = findViewById<EditText>(R.id.blyp_merchant_qr_amount).text.toString().filter { it.isDigit() }
    val amount = raw.toIntOrNull()?.takeIf { it > 0 }
    val url =
      BlypShellPayQr.buildUrl(
        accountId = acc.accountId,
        name = BlypShellCommerceSession.activeCommerceName(this),
        amountFcfa = amount,
        category = acc.category,
        phoneDigits = acc.phone,
      )
    val bmp = if (url.isEmpty()) null else encodeQr(url)
    if (bmp == null) {
      img.visibility = android.view.View.GONE
    } else {
      img.visibility = android.view.View.VISIBLE
      img.setImageBitmap(bmp)
    }
  }

  private fun encodeQr(value: String): Bitmap? {
    return try {
      val size = 512
      val hints =
        mapOf(
          EncodeHintType.MARGIN to 1,
          EncodeHintType.CHARACTER_SET to "UTF-8",
        )
      val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, size, size, hints)
      val on = ContextCompat.getColor(this, R.color.blyp_shell_text)
      val off = ContextCompat.getColor(this, R.color.blyp_shell_surface)
      val pixels = IntArray(size * size)
      var i = 0
      for (y in 0 until size) {
        for (x in 0 until size) {
          pixels[i++] = if (matrix.get(x, y)) on else off
        }
      }
      Bitmap.createBitmap(pixels, size, size, Bitmap.Config.RGB_565)
    } catch (_: Exception) {
      null
    }
  }

  private fun applyBars() {
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
      context.startActivity(Intent(context, ShellMerchantQrActivity::class.java))
    }
  }
}
