package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Coffre, projets, numéros, carte, photos d’articles, compta, caisse sans réseau. */
class ShellPlusActivity : AppCompatActivity() {
  private val prefsName = "blyp_shell_plus_v1"
  private lateinit var root: LinearLayout

  private val pickPhoto =
    registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
      if (uri == null) return@registerForActivityResult
      val file = BlypShellPhotoPick.copyToCache(applicationContext, uri) ?: return@registerForActivityResult
      val dir = File(filesDir, "articles").apply { mkdirs() }
      val dest = File(dir, "${System.currentTimeMillis()}.jpg")
      file.copyTo(dest, overwrite = true)
      val arr = JSONArray(secure().getString("photos", "[]"))
      arr.put(dest.absolutePath)
      secure().edit().putString("photos", arr.toString()).apply()
      paint()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val scroll = ScrollView(this)
    scroll.setBackgroundColor(ContextCompat.getColor(this, R.color.blyp_shell_bg))
    root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    val pad = (16 * resources.displayMetrics.density).toInt()
    root.setPadding(pad, pad, pad, pad)
    scroll.addView(root)
    setContentView(scroll)
    paint()
  }

  private fun secure() = BlypSecurePrefs.get(this, prefsName)

  private fun paint() {
    root.removeAllViews()
    title(getString(R.string.blyp_shell_plus_title))
    val phone = BlypShellSession.phone(this).orEmpty()
    val rows = BlypTransactionStore.loadHistory(this, phone)
    var inn = 0
    var out = 0
    for (row in rows) {
      if (row.type == "received") inn += row.amountFcfa else out += row.amountFcfa
    }
    val fmt = java.text.NumberFormat.getIntegerInstance()
    body(getString(R.string.blyp_shell_plus_accounts, fmt.format(inn), fmt.format(out)))
    val vault = secure().getInt("vault", 0)
    body(getString(R.string.blyp_shell_plus_vault, fmt.format(vault)))
    button(getString(R.string.blyp_shell_plus_add_vault)) { askAmount { add ->
      secure().edit().putInt("vault", (vault + add).coerceAtLeast(0)).apply()
      paint()
    } }
    title(getString(R.string.blyp_shell_plus_projects))
    val projects = JSONArray(secure().getString("projects", "[]"))
    for (i in 0 until projects.length()) {
      val o = projects.optJSONObject(i) ?: continue
      body("${o.optString("name")} · ${fmt.format(o.optInt("amount"))} F")
    }
    button(getString(R.string.blyp_shell_plus_add_project)) { askProject() }
    title(getString(R.string.blyp_shell_plus_momo))
    val momo = JSONArray(secure().getString("momo", "[\"\",\"\",\"\"]"))
    val fields = ArrayList<EditText>()
    for (i in 0 until 3) {
      val edit = EditText(this)
      edit.setText(momo.optString(i))
      edit.inputType = InputType.TYPE_CLASS_PHONE
      edit.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_text))
      edit.hint = getString(R.string.blyp_shell_plus_phone_hint)
      root.addView(edit)
      fields.add(edit)
    }
    button(getString(R.string.blyp_shell_plus_save)) {
      val next = JSONArray()
      var n = 0
      for (edit in fields) {
        val digits = edit.text.toString().filter { it.isDigit() }
        if (digits.isNotEmpty()) {
          if (n >= 3) break
          next.put(digits)
          n++
        }
      }
      while (next.length() < 3) next.put("")
      secure().edit().putString("momo", next.toString()).apply()
      toast(getString(R.string.blyp_shell_plus_saved))
    }
    title(getString(R.string.blyp_shell_plus_card))
    val name = EditText(this)
    name.setText(secure().getString("cardName", ""))
    name.hint = getString(R.string.blyp_shell_plus_card_name)
    name.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_text))
    root.addView(name)
    val last4 = EditText(this)
    last4.setText(secure().getString("cardLast4", ""))
    last4.hint = getString(R.string.blyp_shell_plus_card_last4)
    last4.inputType = InputType.TYPE_CLASS_NUMBER
    last4.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_text))
    root.addView(last4)
    button(getString(R.string.blyp_shell_plus_save)) {
      val four = last4.text.toString().filter { it.isDigit() }.takeLast(4)
      secure().edit().putString("cardName", name.text.toString().trim()).putString("cardLast4", four).apply()
      toast(getString(R.string.blyp_shell_plus_saved))
    }
    title(getString(R.string.blyp_shell_plus_photos))
    val photos = JSONArray(secure().getString("photos", "[]"))
    val row = LinearLayout(this)
    row.orientation = LinearLayout.HORIZONTAL
    val size = (72 * resources.displayMetrics.density).toInt()
    for (i in 0 until photos.length()) {
      val path = photos.optString(i)
      val image = ImageView(this)
      image.layoutParams = LinearLayout.LayoutParams(size, size).apply { marginEnd = 8 }
      image.scaleType = ImageView.ScaleType.CENTER_CROP
      image.setImageBitmap(android.graphics.BitmapFactory.decodeFile(path))
      image.setOnLongClickListener {
        photos.remove(i)
        secure().edit().putString("photos", photos.toString()).apply()
        paint()
        true
      }
      row.addView(image)
    }
    root.addView(row)
    button(getString(R.string.blyp_shell_plus_add_photo)) { pickPhoto.launch("image/*") }
    title(getString(R.string.blyp_shell_plus_offline))
    body(getString(R.string.blyp_shell_plus_vault, fmt.format(vault)))
    button(getString(R.string.blyp_shell_plus_offline_pay)) { askOffline() }
  }

  private fun askOffline() {
    val phone = EditText(this)
    phone.hint = getString(R.string.blyp_shell_plus_phone_hint)
    phone.inputType = InputType.TYPE_CLASS_PHONE
    val amount = EditText(this)
    amount.hint = getString(R.string.blyp_shell_plus_amount_hint)
    amount.inputType = InputType.TYPE_CLASS_NUMBER
    val box = LinearLayout(this)
    box.orientation = LinearLayout.VERTICAL
    box.addView(phone)
    box.addView(amount)
    AlertDialog.Builder(this)
      .setTitle(R.string.blyp_shell_plus_offline_pay)
      .setView(box)
      .setPositiveButton(R.string.blyp_shell_plus_save) { _, _ ->
        val digits = phone.text.toString().filter { it.isDigit() }
        val value = amount.text.toString().filter { it.isDigit() }.toIntOrNull() ?: 0
        val vault = secure().getInt("vault", 0)
        if (digits.length < 8 || value <= 0 || value > vault) {
          toast(getString(R.string.blyp_shell_plus_short))
          return@setPositiveButton
        }
        secure().edit().putInt("vault", vault - value).apply()
        val recipient =
          JSONObject().put("phoneDigits", digits).put("name", digits).put("accountId", "").toString()
        BlypShellOfflinePayQueue.enqueue(this, value, UUID.randomUUID().toString(), recipient)
        toast(getString(R.string.blyp_shell_plus_offline_done))
        paint()
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun askProject() {
    val name = EditText(this)
    name.hint = getString(R.string.blyp_shell_plus_project_hint)
    val amount = EditText(this)
    amount.hint = getString(R.string.blyp_shell_plus_amount_hint)
    amount.inputType = InputType.TYPE_CLASS_NUMBER
    val box = LinearLayout(this)
    box.orientation = LinearLayout.VERTICAL
    box.addView(name)
    box.addView(amount)
    AlertDialog.Builder(this)
      .setTitle(R.string.blyp_shell_plus_add_project)
      .setView(box)
      .setPositiveButton(R.string.blyp_shell_plus_save) { _, _ ->
        val label = name.text.toString().trim()
        val value = amount.text.toString().filter { it.isDigit() }.toIntOrNull() ?: 0
        if (label.isEmpty() || value <= 0) return@setPositiveButton
        val arr = JSONArray(secure().getString("projects", "[]"))
        arr.put(JSONObject().put("name", label).put("amount", value))
        secure().edit().putString("projects", arr.toString()).apply()
        paint()
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun askAmount(onValue: (Int) -> Unit) {
    val amount = EditText(this)
    amount.hint = getString(R.string.blyp_shell_plus_amount_hint)
    amount.inputType = InputType.TYPE_CLASS_NUMBER
    AlertDialog.Builder(this)
      .setTitle(R.string.blyp_shell_plus_add_vault)
      .setView(amount)
      .setPositiveButton(R.string.blyp_shell_plus_save) { _, _ ->
        val value = amount.text.toString().filter { it.isDigit() }.toIntOrNull() ?: 0
        if (value > 0) onValue(value)
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun title(text: String) {
    val tv = TextView(this)
    tv.text = text
    tv.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_text))
    tv.textSize = 16f
    tv.setTypeface(tv.typeface, Typeface.BOLD)
    tv.setPadding(0, (18 * resources.displayMetrics.density).toInt(), 0, 6)
    root.addView(tv)
  }

  private fun body(text: String) {
    val tv = TextView(this)
    tv.text = text
    tv.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_text_secondary))
    tv.textSize = 14f
    root.addView(tv)
  }

  private fun button(text: String, onClick: () -> Unit) {
    val tv = TextView(this)
    tv.text = text
    tv.setTextColor(ContextCompat.getColor(this, R.color.blyp_shell_accent))
    tv.textSize = 15f
    tv.setTypeface(tv.typeface, Typeface.BOLD)
    tv.setPadding(0, (10 * resources.displayMetrics.density).toInt(), 0, 4)
    tv.setOnClickListener { onClick() }
    root.addView(tv)
  }

  private fun toast(text: String) {
    Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
  }

  companion object {
    fun start(context: Context) {
      context.startActivity(Intent(context, ShellPlusActivity::class.java))
    }
  }
}
