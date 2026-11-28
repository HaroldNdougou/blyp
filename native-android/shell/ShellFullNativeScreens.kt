package com.haroldndougou.blyp.shell

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Outline
import android.media.ExifInterface
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R
import java.io.File

class ShellProfileSettingsActivity : BlypShellActivity() {
  private var picking = false
  private var photoBusy = false
  private var photoDirty = false
  private var circle: BlypCirclePhoto? = null

  private val pickImage =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val uri = if (result.resultCode == RESULT_OK) onePhoto(result.data) else null
      picking = false
      if (uri == null) return@registerForActivityResult
      Thread {
        val file = copyPickToCache(uri)
        val bmp = file?.let { decodeOriented(it) }
        runOnUiThread {
          if (bmp != null) showPicked(bmp)
          else toast(getString(R.string.blyp_shell_profile_photo_failed))
        }
      }.start()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_profile_settings)
    applyBars()
    clipCircle(findViewById(R.id.blyp_settings_avatar_frame))
    bindProfile()
    bindThemes()
    findViewById<View>(R.id.blyp_settings_back).setOnClickListener { leave() }
    findViewById<TextView>(R.id.blyp_settings_change_photo).setOnClickListener { startPhotoPick() }
    findViewById<TextView>(R.id.blyp_settings_save).setOnClickListener { saveName() }
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          leave()
        }
      },
    )
  }

  private fun bindProfile() {
    val p = BlypShellSession.profile(this) ?: return
    findViewById<EditText>(R.id.blyp_settings_name).setText(p.displayName)
    val initial = findViewById<TextView>(R.id.blyp_settings_avatar_initial)
    val img = findViewById<ImageView>(R.id.blyp_settings_avatar)
    if (!photoDirty) img.scaleType = ImageView.ScaleType.CENTER_CROP
    initial.text =
      p.displayName.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
    val url = p.avatarUrl
    if (!url.isNullOrBlank()) {
      BlypShellAvatarLoader.loadInto(url, img, initial, initial.text.toString())
    }
  }

  private fun bindThemes() {
    val row = findViewById<android.widget.LinearLayout>(R.id.blyp_settings_theme_row) ?: return
    row.removeAllViews()
    val d = resources.displayMetrics.density
    val selected = BlypShellAccent.current(this)
    val en = resources.configuration.locales[0].language != "fr"
    for (skin in BlypShellAccent.all()) {
      val wrap =
        android.widget.FrameLayout(this).apply {
          layoutParams =
            android.widget.LinearLayout.LayoutParams(
              (48 * d).toInt(),
              (48 * d).toInt(),
            ).also { it.marginEnd = (10 * d).toInt() }
          isClickable = true
          isFocusable = true
          contentDescription = if (en) skin.labelEn else skin.labelFr
        }
      if (skin == selected) {
        val ring =
          View(this).apply {
            layoutParams =
              android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
              )
            setBackgroundResource(R.drawable.blyp_shell_theme_swatch_ring)
          }
        wrap.addView(ring)
      }
      val dot =
        View(this).apply {
          val size = (36 * d).toInt()
          layoutParams =
            android.widget.FrameLayout.LayoutParams(size, size).apply {
              gravity = android.view.Gravity.CENTER
            }
          val bg =
            ContextCompat.getDrawable(this@ShellProfileSettingsActivity, R.drawable.blyp_shell_theme_swatch)
              ?.mutate()
          bg?.setTint(skin.accent)
          background = bg
        }
      wrap.addView(dot)
      wrap.setOnClickListener {
        if (skin == BlypShellAccent.current(this)) return@setOnClickListener
        it.performHapticFeedback(android.view.HapticFeedbackConstants.CONTEXT_CLICK)
        BlypShellAccent.set(this, skin)
      }
      row.addView(wrap)
    }
  }

  private fun saveName() {
    if (photoBusy) return
    val name = findViewById<EditText>(R.id.blyp_settings_name).text.toString().trim()
    val file = if (photoDirty) circle?.export(cacheDir) else null
    if (name.isEmpty() && file == null) return
    val btn = findViewById<TextView>(R.id.blyp_settings_save)
    btn.isEnabled = false
    photoBusy = true
    BlypButtonSpinner.show(btn)
    Thread {
      val photoOk = file == null || BlypShellProfileClient.uploadAvatar(this, file, "image/jpeg")
      val nameOk = name.isEmpty() || BlypShellProfileClient.updateFullName(this, name) != null
      runOnUiThread {
        photoBusy = false
        btn.isEnabled = true
        BlypButtonSpinner.hide(btn)
        val ok = photoOk && nameOk
        toast(
          if (ok) getString(R.string.blyp_shell_settings_saved)
          else getString(R.string.blyp_shell_settings_failed),
        )
        if (ok) {
          photoDirty = false
          finish()
        }
      }
    }.start()
  }

  private fun leave() {
    if (photoBusy) return
    val file = if (photoDirty) circle?.export(cacheDir) else null
    if (file == null) {
      finish()
      return
    }
    photoBusy = true
    photoDirty = false
    Thread {
      val ok = BlypShellProfileClient.uploadAvatar(this, file, "image/jpeg")
      runOnUiThread {
        if (!ok) toast(getString(R.string.blyp_shell_profile_photo_failed))
        finish()
      }
    }.start()
  }

  private fun showPicked(bmp: Bitmap) {
    val img = findViewById<ImageView>(R.id.blyp_settings_avatar)
    findViewById<TextView>(R.id.blyp_settings_avatar_initial).visibility = View.GONE
    img.visibility = View.VISIBLE
    val framed = circle ?: BlypCirclePhoto(img).also {
      it.attach()
      circle = it
    }
    framed.show(bmp)
    photoDirty = true
  }

  private fun startPhotoPick() {
    if (photoBusy || picking) return
    picking = true
    val base =
      Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
        type = "image/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
      }
    val tries =
      listOf(
        Intent(base).apply {
          component =
            ComponentName("com.miui.gallery", "com.miui.gallery.picker.PickGalleryActivity")
        },
        Intent(base).apply { setPackage("com.miui.gallery") },
        Intent(base),
        Intent(Intent.ACTION_GET_CONTENT).apply {
          type = "image/*"
          addCategory(Intent.CATEGORY_OPENABLE)
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
        },
      )
    for (intent in tries) {
      try {
        pickImage.launch(intent)
        return
      } catch (_: Exception) {
      }
    }
    picking = false
    toast(getString(R.string.blyp_shell_profile_photo_failed))
  }

  private fun onePhoto(data: Intent?): Uri? {
    val direct = data?.data
    if (direct != null) return direct
    val clip = data?.clipData ?: return null
    return if (clip.itemCount > 0) clip.getItemAt(0).uri else null
  }

  private fun clipCircle(view: View) {
    view.outlineProvider =
      object : ViewOutlineProvider() {
        override fun getOutline(v: View, outline: Outline) {
          val w = v.width
          val h = v.height
          if (w <= 0 || h <= 0) return
          outline.setOval(0, 0, w, h)
        }
      }
    view.clipToOutline = true
  }

  private fun decodeOriented(file: File): Bitmap? {
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.absolutePath, bounds)
      var sample = 1
      val maxSide = maxOf(bounds.outWidth, bounds.outHeight)
      while (maxSide / sample > 1600) sample *= 2
      val raw =
        BitmapFactory.decodeFile(
          file.absolutePath,
          BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: return null
      val rotation =
        when (
          ExifInterface(file.absolutePath).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
          )
        ) {
          ExifInterface.ORIENTATION_ROTATE_90 -> 90f
          ExifInterface.ORIENTATION_ROTATE_180 -> 180f
          ExifInterface.ORIENTATION_ROTATE_270 -> 270f
          else -> 0f
        }
      if (rotation == 0f) raw
      else {
        val rotated =
          Bitmap.createBitmap(
            raw,
            0,
            0,
            raw.width,
            raw.height,
            Matrix().apply { postRotate(rotation) },
            true,
          )
        if (rotated != raw) raw.recycle()
        rotated
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun copyPickToCache(uri: Uri): File? {
    return try {
      val out = File(cacheDir, "avatar-pick-${System.currentTimeMillis()}.jpg")
      contentResolver.openInputStream(uri)?.use { input ->
        out.outputStream().use { output -> input.copyTo(output) }
      }
      out.takeIf { it.length() > 0 }
    } catch (_: Exception) {
      null
    }
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
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
      context.startActivity(
        Intent(context, ShellProfileSettingsActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}

class ShellKycCaptureActivity : AppCompatActivity() {
  private var step = 0
  private var frontKey: String? = null
  private var backKey: String? = null
  private var photoFile: File? = null

  private val takePicture =
    registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
      val file = photoFile
      if (!ok || file == null || !file.isFile) {
        toast(getString(R.string.blyp_shell_kyc_capture_failed))
        return@registerForActivityResult
      }
      onPhotoTaken(file)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_kyc_capture)
    applyBars()
    findViewById<View>(R.id.blyp_kyc_cap_back).setOnClickListener { finish() }
    findViewById<TextView>(R.id.blyp_kyc_cap_primary).setOnClickListener {
      if (findViewById<ImageView>(R.id.blyp_kyc_cap_preview).drawable == null) {
        launchCamera()
      } else {
        uploadCurrentStep()
      }
    }
    refreshStepUi()
    launchCamera()
  }

  private fun refreshStepUi() {
    val stepView = findViewById<TextView>(R.id.blyp_kyc_cap_step)
    val hint = findViewById<TextView>(R.id.blyp_kyc_cap_hint)
    val primary = findViewById<TextView>(R.id.blyp_kyc_cap_primary)
    when (step) {
      0 -> {
        stepView.setText(R.string.blyp_shell_kyc_step_front)
        hint.setText(R.string.blyp_shell_kyc_hint_front)
        primary.setText(R.string.blyp_shell_kyc_cap_shoot)
      }
      1 -> {
        stepView.setText(R.string.blyp_shell_kyc_step_back)
        hint.setText(R.string.blyp_shell_kyc_hint_back)
        primary.setText(R.string.blyp_shell_kyc_cap_shoot)
      }
      else -> {
        stepView.setText(R.string.blyp_shell_kyc_step_selfie)
        hint.setText(R.string.blyp_shell_kyc_hint_selfie)
        primary.setText(R.string.blyp_shell_kyc_cap_shoot)
      }
    }
    findViewById<ImageView>(R.id.blyp_kyc_cap_preview).setImageDrawable(null)
  }

  private fun launchCamera() {
    val file = File(cacheDir, "kyc-${step}-${System.currentTimeMillis()}.jpg")
    photoFile = file
    val uri =
      FileProvider.getUriForFile(
        this,
        "${packageName}.blyp.shell.fileprovider",
        file,
      )
    takePicture.launch(uri)
  }

  private fun onPhotoTaken(file: File) {
    findViewById<ImageView>(R.id.blyp_kyc_cap_preview).setImageURI(Uri.fromFile(file))
    findViewById<TextView>(R.id.blyp_kyc_cap_primary).setText(R.string.blyp_shell_kyc_cap_confirm)
  }

  private fun uploadCurrentStep() {
    val file = photoFile ?: return
    val side =
      when (step) {
        0 -> "front"
        1 -> "back"
        else -> "selfie"
      }
    val btn = findViewById<TextView>(R.id.blyp_kyc_cap_primary)
    if (!btn.isEnabled) return
    btn.isEnabled = false
    BlypButtonSpinner.show(btn)
    Thread {
      val key = BlypShellKycClient.uploadSide(this, side, file, "image/jpeg")
      val f = frontKey
      val b = backKey
      val submitted =
        if (key != null && step >= 2 && f != null && b != null) {
          BlypShellKycClient.submit(this, f, b, key)
        } else {
          null
        }
      runOnUiThread {
        btn.isEnabled = true
        BlypButtonSpinner.hide(btn)
        if (key == null) {
          toast(getString(R.string.blyp_shell_kyc_capture_failed))
          return@runOnUiThread
        }
        when (step) {
          0 -> {
            frontKey = key
            step = 1
            refreshStepUi()
            launchCamera()
          }
          1 -> {
            backKey = key
            step = 2
            refreshStepUi()
            launchCamera()
          }
          else -> {
            val ok = submitted == true
            toast(
              if (ok) getString(R.string.blyp_shell_kyc_submitted)
              else getString(R.string.blyp_shell_kyc_capture_failed),
            )
            if (ok) finish()
          }
        }
      }
    }.start()
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
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
      context.startActivity(
        Intent(context, ShellKycCaptureActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}

class ShellReceiptAddActivity : AppCompatActivity() {
  private var pickedFile: File? = null
  private var contentType: String = "image/jpeg"

  private val pickDoc =
    registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
      if (uri != null) ingestUri(uri, "image/jpeg")
    }

  private val takePicture =
    registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
      val f = pickedFile
      if (ok && f != null && f.isFile) {
        contentType = "image/jpeg"
      } else {
        pickedFile = null
      }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_receipt_add)
    applyBars()
    findViewById<View>(R.id.blyp_receipt_add_back).setOnClickListener { finish() }
    findViewById<TextView>(R.id.blyp_receipt_add_pick).setOnClickListener {
      pickDoc.launch("*/*")
    }
    findViewById<TextView>(R.id.blyp_receipt_add_camera).setOnClickListener {
      val file = File(cacheDir, "receipt-${System.currentTimeMillis()}.jpg")
      pickedFile = file
      val uri =
        FileProvider.getUriForFile(
          this,
          "${packageName}.blyp.shell.fileprovider",
          file,
        )
      takePicture.launch(uri)
    }
    findViewById<TextView>(R.id.blyp_receipt_add_save).setOnClickListener { save() }
  }

  private fun ingestUri(uri: Uri, ct: String) {
    try {
      val out = File(cacheDir, "receipt-pick-${System.currentTimeMillis()}")
      contentResolver.openInputStream(uri)?.use { input ->
        out.outputStream().use { output -> input.copyTo(output) }
      }
      if (out.length() > 0) {
        pickedFile = out
        contentType = ct
      }
    } catch (_: Exception) {
      /* ignore */
    }
  }

  private fun save() {
    val file = pickedFile
    val accountId = BlypShellSession.accountId(this)
    if (file == null || !file.isFile || accountId.isNullOrEmpty()) {
      toast(getString(R.string.blyp_shell_receipt_add_missing))
      return
    }
    val name = findViewById<EditText>(R.id.blyp_receipt_add_name).text.toString()
    val ok = BlypMerchantReceiptStore.addManual(this, accountId, name, file, contentType)
    toast(
      if (ok) getString(R.string.blyp_shell_receipt_add_done)
      else getString(R.string.blyp_shell_settings_failed),
    )
    if (ok) finish()
  }

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
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
      context.startActivity(
        Intent(context, ShellReceiptAddActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}
