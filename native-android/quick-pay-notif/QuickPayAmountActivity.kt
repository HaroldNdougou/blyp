package com.haroldndougou.blyp.quickpaynotif

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.haroldndougou.blyp.R

/** Montant tapé depuis la notification, puis la même confirmation que les montants rapides. */
class QuickPayAmountActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContentView(R.layout.quick_pay_amount)
    val field = findViewById<EditText>(R.id.quick_pay_amount_input)
    findViewById<android.view.View>(R.id.quick_pay_amount_back).setOnClickListener {
      finishAndRemoveTask()
    }
    findViewById<TextView>(R.id.quick_pay_amount_ok).setOnClickListener {
      val amount = field.text.toString().filter { it.isDigit() }.take(7).toIntOrNull() ?: 0
      if (amount <= 0) {
        Toast.makeText(this, R.string.quick_pay_amount_invalid, Toast.LENGTH_SHORT).show()
        return@setOnClickListener
      }
      if (!QuickPayNativeSecrets.isReady(this)) {
        Toast.makeText(this, R.string.quick_pay_no_recipient, Toast.LENGTH_SHORT).show()
        return@setOnClickListener
      }
      QuickPayAuthActivity.start(this, amount)
      finishAndRemoveTask()
    }
    field.requestFocus()
    field.post {
      val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
      imm.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
    }
  }
}
