package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.Paint
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.animation.AnimationUtils
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.ViewFlipper
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.PickVisualMediaRequest
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.haroldndougou.blyp.R
import java.io.File

/** Inscription native : nom → photo (facultatif) → PIN. */
class ShellNativeOnboardingActivity : AppCompatActivity() {
  private var busy = false
  private var picking = false
  private lateinit var flipper: ViewFlipper
  private var avatarFile: File? = null
  private var photoBitmap: Bitmap? = null
  private val photoMatrix = Matrix()
  private var photoScale = 1f
  private var minPhotoScale = 1f
  private var gestureLastX = 0f
  private var gestureLastY = 0f
  private var gestureLastSpan = 0f
  private var gestureMoved = false
  private var lastTapAt = 0L
  private var pendingMatrix: FloatArray? = null
  private var keepDraft = true
  private val draftPrefs by lazy { getSharedPreferences(DRAFT_PREFS, MODE_PRIVATE) }

  /** Fichier temporaire pour la prise de photo caméra. */
  private var cameraFile: File? = null

  private val pickVisual =
    registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
      if (uri == null) {
        endPhotoPick()
        return@registerForActivityResult
      }
      consumePickedUri(uri)
    }

  private val pickContent =
    registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
      if (uri == null) {
        endPhotoPick()
        return@registerForActivityResult
      }
      consumePickedUri(uri)
    }

  private val pickImage =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      if (result.resultCode != RESULT_OK) {
        endPhotoPick()
        return@registerForActivityResult
      }
      val uri = BlypShellPhotoPick.onePhotoFromResult(result.data)
      if (uri == null) {
        endPhotoPick()
        toast(getString(R.string.blyp_shell_profile_photo_failed))
        return@registerForActivityResult
      }
      consumePickedUri(uri)
    }

  private val takePicture =
    registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
      val file = cameraFile
      cameraFile = null
      if (!ok || file == null || !file.isFile) {
        endPhotoPick()
        return@registerForActivityResult
      }
      consumePickedFile(file)
    }

  private val cameraPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (!granted) {
        endPhotoPick()
        toast(getString(R.string.blyp_shell_onboarding_camera_denied))
        return@registerForActivityResult
      }
      launchCameraCapture()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!BlypShellSession.hasValidSession(this)) {
      ShellSignInActivity.startFresh(this)
      finish()
      return
    }
    if (!BlypShellSession.needsOnboarding(this)) {
      openShell()
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_onboarding)
    applySystemBarAppearance()
    flipper = findViewById(R.id.blyp_onboarding_flipper)
    val nameInput = findViewById<EditText>(R.id.blyp_onboarding_name)
    val pinInput = findViewById<EditText>(R.id.blyp_onboarding_pin)
    val pinConfirm = findViewById<EditText>(R.id.blyp_onboarding_pin_confirm)
    BlypDigitLines(findViewById<LinearLayout>(R.id.blyp_onboarding_pin_cells), pinInput, 4, masked = true) { d ->
      if (d.length == 4 && flipper.displayedChild == 2 && !busy) openPinConfirm()
    }
    BlypDigitLines(
      findViewById<LinearLayout>(R.id.blyp_onboarding_pin_confirm_cells),
      pinConfirm,
      4,
      masked = true,
    ) { d ->
      if (d.length == 4 && flipper.displayedChild == 3 && !busy) submitPin()
    }

    findViewById<TextView>(R.id.blyp_onboarding_name_next).setOnClickListener {
      if (busy) return@setOnClickListener
      val split = splitFullName(nameInput.text.toString())
      if (split == null) {
        toast(getString(R.string.blyp_shell_onboarding_name_invalid))
        return@setOnClickListener
      }
      busy = true
      val btn = it
      BlypButtonSpinner.show(btn)
      BlypShellAuthClient.setOnboardingProfileAsync(
        this,
        split.first,
        split.second,
      ) { user, _ ->
        runOnUiThread {
          busy = false
          BlypButtonSpinner.hide(btn)
          if (user == null) {
            toast(getString(R.string.blyp_shell_settings_failed))
            return@runOnUiThread
          }
          showStep(1, forward = true)
          bindPhotoPreview()
        }
      }
    }

    val photoFrame = findViewById<View>(R.id.blyp_onboarding_photo_frame)
    val photoView = findViewById<ImageView>(R.id.blyp_onboarding_photo)
    clipCircle(photoFrame)
    clipCircle(photoView)
    photoFrame.post {
      photoFrame.invalidateOutline()
      photoView.invalidateOutline()
    }
    photoFrame.isClickable = true
    photoFrame.setOnClickListener { startPhotoPick() }
    attachPhotoGestures(photoView)
    findViewById<View>(R.id.blyp_onboarding_photo_back).setOnClickListener { goBackFromPhoto() }
    findViewById<TextView>(R.id.blyp_onboarding_photo_pick).setOnClickListener { startPhotoPick() }
    findViewById<TextView>(R.id.blyp_onboarding_photo_camera).setOnClickListener { startCameraCapture() }
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (::flipper.isInitialized && flipper.displayedChild > 0) {
            showStep(flipper.displayedChild - 1, forward = false)
            return
          }
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
        }
      },
    )
    findViewById<TextView>(R.id.blyp_onboarding_photo_skip).setOnClickListener {
      showStep(2, forward = true)
    }
    findViewById<TextView>(R.id.blyp_onboarding_photo_next).setOnClickListener {
      if (busy) return@setOnClickListener
      val framed = exportFramedPhoto()
      if (framed == null || !framed.isFile) {
        showStep(2, forward = true)
        return@setOnClickListener
      }
      busy = true
      val btn = it
      BlypButtonSpinner.show(btn)
      Thread {
        val ok = BlypShellProfileClient.uploadAvatar(this, framed, "image/jpeg")
        runOnUiThread {
          busy = false
          BlypButtonSpinner.hide(btn)
          if (!ok) {
            toast(getString(R.string.blyp_shell_profile_photo_failed))
            return@runOnUiThread
          }
          showStep(2, forward = true)
        }
      }.start()
    }

    findViewById<View>(R.id.blyp_onboarding_pin_back).setOnClickListener {
      showStep(1, forward = false)
    }
    findViewById<View>(R.id.blyp_onboarding_pin_confirm_back).setOnClickListener {
      showStep(2, forward = false)
    }
    findViewById<TextView>(R.id.blyp_onboarding_pin_next).setOnClickListener { openPinConfirm() }
    findViewById<TextView>(R.id.blyp_onboarding_pin_finish).setOnClickListener { submitPin() }
    restoreDraft()
  }

  private fun pinDigits(id: Int): String =
    findViewById<EditText>(id).text.toString().filter { it.isDigit() }.take(4)

  private fun openPinConfirm() {
    if (busy) return
    if (pinDigits(R.id.blyp_onboarding_pin).length != 4) {
      toast(getString(R.string.blyp_shell_auth_otp_invalid))
      return
    }
    findViewById<EditText>(R.id.blyp_onboarding_pin_confirm).setText("")
    showStep(3, forward = true)
  }

  private fun submitPin() {
    if (busy) return
    val pin = pinDigits(R.id.blyp_onboarding_pin)
    val confirm = pinDigits(R.id.blyp_onboarding_pin_confirm)
    if (pin.length != 4 || confirm.length != 4) {
      toast(getString(R.string.blyp_shell_auth_otp_invalid))
      return
    }
    if (pin != confirm) {
      toast(getString(R.string.blyp_shell_onboarding_pin_mismatch))
      findViewById<EditText>(R.id.blyp_onboarding_pin_confirm).setText("")
      return
    }
    busy = true
    val btn = findViewById<View>(R.id.blyp_onboarding_pin_finish)
    BlypButtonSpinner.show(btn)
    BlypShellAuthClient.setOnboardingPinAsync(this, pin) { user, _ ->
      runOnUiThread {
        busy = false
        BlypButtonSpinner.hide(btn)
        if (user == null || BlypShellSession.needsOnboarding(this)) {
          toast(getString(R.string.blyp_shell_settings_failed))
          return@runOnUiThread
        }
        openShell()
      }
    }
  }

  override fun onResume() {
    super.onResume()
    if (!::flipper.isInitialized) return
    val step = flipper.displayedChild
    if (step == 2 || step == 3) focusPin(step)
  }

  override fun onPause() {
    saveDraft()
    super.onPause()
  }

  private fun saveDraft() {
    if (!keepDraft || !::flipper.isInitialized) return
    val name = findViewById<EditText>(R.id.blyp_onboarding_name)?.text?.toString().orEmpty()
    val matrix = FloatArray(9)
    photoMatrix.getValues(matrix)
    draftPrefs.edit()
      .putInt(DRAFT_STEP, flipper.displayedChild)
      .putString(DRAFT_NAME, name)
      .putString(DRAFT_PHOTO, avatarFile?.takeIf { it.isFile }?.absolutePath.orEmpty())
      .putString(DRAFT_MATRIX, if (photoBitmap != null) matrix.joinToString(",") else "")
      .apply()
  }

  private fun restoreDraft() {
    if (!draftPrefs.contains(DRAFT_STEP)) return
    val name = draftPrefs.getString(DRAFT_NAME, "").orEmpty()
    findViewById<EditText>(R.id.blyp_onboarding_name).setText(name)
    val path = draftPrefs.getString(DRAFT_PHOTO, "").orEmpty()
    if (path.isNotEmpty()) {
      val file = File(path)
      if (file.isFile) {
        avatarFile = file
        photoBitmap = decodeOriented(file)
        val raw = draftPrefs.getString(DRAFT_MATRIX, "").orEmpty()
        val values = raw.split(',').mapNotNull { it.toFloatOrNull() }
        if (values.size == 9) pendingMatrix = values.toFloatArray()
      }
    }
    val step = draftPrefs.getInt(DRAFT_STEP, 0).coerceIn(0, 3)
    if (step != 0) {
      flipper.inAnimation = null
      flipper.outAnimation = null
      window.setSoftInputMode(
        if (step == 1) WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
        else WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED,
      )
      flipper.displayedChild = step
      if (step == 1) hideKeyboard()
      if (step == 2 || step == 3) focusPin(step)
    }
    bindPhotoPreview()
  }

  private fun clearDraft() {
    keepDraft = false
    draftPrefs.edit().clear().apply()
  }

  private fun goBackFromPhoto() {
    showStep(0, forward = false)
  }

  private fun showStep(index: Int, forward: Boolean) {
    if (!::flipper.isInitialized || flipper.displayedChild == index) return
    if (!forward && (busy || picking)) return
    window.setSoftInputMode(
      if (index == 1) WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
      else WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED,
    )
    if (index == 1) hideKeyboard()
    flipper.inAnimation =
      AnimationUtils.loadAnimation(
        this,
        if (forward) R.anim.blyp_slide_in_right else R.anim.blyp_slide_in_left,
      )
    flipper.outAnimation =
      AnimationUtils.loadAnimation(
        this,
        if (forward) R.anim.blyp_slide_out_left else R.anim.blyp_slide_out_right,
      )
    flipper.displayedChild = index
    if (index == 2 || index == 3) focusPin(index)
  }

  private fun focusPin(index: Int) {
    val input =
      findViewById<EditText>(
        if (index == 3) R.id.blyp_onboarding_pin_confirm else R.id.blyp_onboarding_pin,
      ) ?: return
    window.setSoftInputMode(
      WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
        WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE,
    )
    input.isFocusableInTouchMode = true
    val imm = getSystemService(InputMethodManager::class.java) ?: return
    val open = Runnable {
      if (!::flipper.isInitialized || flipper.displayedChild != index) return@Runnable
      input.requestFocus()
      imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }
    input.post(open)
    input.postDelayed(open, 280)
  }

  private fun hideKeyboard() {
    val focused = currentFocus
    val token = focused?.windowToken ?: window.decorView.windowToken
    getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(token, 0)
    focused?.clearFocus()
  }

  private fun endPhotoPick() {
    picking = false
    setPhotoPickBusy(false)
  }

  private fun consumePickedUri(uri: Uri) {
    Thread {
      val file = BlypShellPhotoPick.copyToCache(applicationContext, uri)
      applyPickedFile(file)
    }.start()
  }

  private fun consumePickedFile(file: File) {
    Thread { applyPickedFile(file) }.start()
  }

  private fun applyPickedFile(file: File?) {
    val bmp = file?.let { decodeOriented(it) }
    runOnUiThread {
      endPhotoPick()
      if (file != null && bmp != null) {
        avatarFile = file
        photoBitmap?.let { old -> if (old != bmp && !old.isRecycled) old.recycle() }
        photoBitmap = bmp
        bindPhotoPreview()
      } else {
        toast(getString(R.string.blyp_shell_profile_photo_failed))
      }
    }
  }

  private fun startCameraCapture() {
    if (busy || picking) return
    picking = true
    setPhotoPickBusy(true)
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      cameraPermission.launch(Manifest.permission.CAMERA)
      return
    }
    launchCameraCapture()
  }

  private fun launchCameraCapture() {
    val file = File(cacheDir, "onboard-camera-${System.currentTimeMillis()}.jpg")
    cameraFile = file
    val uri =
      FileProvider.getUriForFile(
        this,
        "${packageName}.blyp.shell.fileprovider",
        file,
      )
    try {
      takePicture.launch(uri)
    } catch (_: Exception) {
      cameraFile = null
      endPhotoPick()
      toast(getString(R.string.blyp_shell_profile_photo_failed))
    }
  }

  private fun startPhotoPick() {
    if (busy || picking) return
    picking = true
    setPhotoPickBusy(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      try {
        pickVisual.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        return
      } catch (_: Exception) {
        /* suite */
      }
    }
    try {
      pickContent.launch("image/*")
      return
    } catch (_: Exception) {
      /* suite */
    }
    for (intent in BlypShellPhotoPick.galleryPickIntents()) {
      try {
        pickImage.launch(intent)
        return
      } catch (_: Exception) {
      }
    }
    endPhotoPick()
    toast(getString(R.string.blyp_shell_profile_photo_failed))
  }

  private fun setPhotoPickBusy(on: Boolean) {
    findViewById<View>(R.id.blyp_onboarding_photo_busy)?.visibility =
      if (on) View.VISIBLE else View.GONE
    val pick = findViewById<View>(R.id.blyp_onboarding_photo_pick)
    BlypButtonSpinner.set(pick, on)
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

  private fun bindPhotoPreview() {
    val img = findViewById<ImageView>(R.id.blyp_onboarding_photo)
    val initial = findViewById<TextView>(R.id.blyp_onboarding_photo_initial)
    val pick = findViewById<TextView>(R.id.blyp_onboarding_photo_pick)
    val bmp = photoBitmap
    if (bmp != null && !bmp.isRecycled) {
      img.scaleType = ImageView.ScaleType.MATRIX
      img.setImageBitmap(bmp)
      img.visibility = View.VISIBLE
      initial.visibility = View.GONE
      pick.setText(R.string.blyp_shell_onboarding_photo_change)
      centerPhoto(img)
    } else {
      val name = BlypShellSession.profile(this)?.displayName ?: "?"
      initial.text = name.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
      img.setImageDrawable(null)
      img.visibility = View.GONE
      initial.visibility = View.VISIBLE
      pick.setText(R.string.blyp_shell_onboarding_photo_pick)
    }
  }

  private fun attachPhotoGestures(img: ImageView) {
    val slop = ViewConfiguration.get(img.context).scaledTouchSlop
    img.setOnTouchListener { v, event ->
      if (photoBitmap == null || img.visibility != View.VISIBLE) return@setOnTouchListener false
      var parent = v.parent
      while (parent != null) {
        parent.requestDisallowInterceptTouchEvent(true)
        parent = parent.parent
      }
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          gestureLastX = event.x
          gestureLastY = event.y
          gestureMoved = false
          true
        }
        MotionEvent.ACTION_POINTER_DOWN -> {
          gestureLastSpan = pointerSpan(event)
          true
        }
        MotionEvent.ACTION_MOVE -> {
          if (event.pointerCount >= 2 && gestureLastSpan > 0f) {
            val span = pointerSpan(event)
            if (span > 0f) {
              zoomPhoto(img, span / gestureLastSpan, (event.getX(0) + event.getX(1)) / 2f, (event.getY(0) + event.getY(1)) / 2f)
              gestureLastSpan = span
              gestureMoved = true
            }
          } else if (event.pointerCount == 1) {
            val dx = event.x - gestureLastX
            val dy = event.y - gestureLastY
            if (kotlin.math.abs(dx) > slop || kotlin.math.abs(dy) > slop) gestureMoved = true
            photoMatrix.postTranslate(dx, dy)
            clampPhoto(img)
            img.imageMatrix = photoMatrix
            gestureLastX = event.x
            gestureLastY = event.y
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!gestureMoved) {
            val now = SystemClock.uptimeMillis()
            if (now - lastTapAt < 280) {
              centerPhoto(img)
              lastTapAt = 0L
            } else {
              lastTapAt = now
            }
          }
          gestureLastSpan = 0f
          true
        }
        MotionEvent.ACTION_POINTER_UP -> {
          val keep = if (event.actionIndex == 0) 1 else 0
          if (keep < event.pointerCount) {
            gestureLastX = event.getX(keep)
            gestureLastY = event.getY(keep)
          }
          gestureLastSpan = 0f
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          gestureLastSpan = 0f
          true
        }
        else -> false
      }
    }
  }

  private fun centerPhoto(img: ImageView) {
    val bmp = photoBitmap ?: return
    val w = img.width.toFloat()
    val h = img.height.toFloat()
    if (w <= 0f || h <= 0f) {
      img.post { centerPhoto(img) }
      return
    }
    val scale = maxOf(w / bmp.width, h / bmp.height)
    minPhotoScale = scale
    val saved = pendingMatrix
    if (saved != null && saved.size == 9) {
      pendingMatrix = null
      photoMatrix.setValues(saved)
      photoScale = saved[Matrix.MSCALE_X].takeIf { it > 0f } ?: scale
      clampPhoto(img)
      img.imageMatrix = photoMatrix
      return
    }
    photoScale = scale
    photoMatrix.reset()
    photoMatrix.postScale(scale, scale)
    photoMatrix.postTranslate((w - bmp.width * scale) / 2f, (h - bmp.height * scale) / 2f)
    img.imageMatrix = photoMatrix
  }

  private fun zoomPhoto(img: ImageView, factor: Float, focusX: Float, focusY: Float) {
    val next = (photoScale * factor).coerceIn(minPhotoScale, minPhotoScale * 4f)
    if (next == photoScale) return
    val applied = next / photoScale
    photoMatrix.postScale(applied, applied, focusX, focusY)
    photoScale = next
    clampPhoto(img)
    img.imageMatrix = photoMatrix
  }

  private fun clampPhoto(img: ImageView) {
    val bmp = photoBitmap ?: return
    val w = img.width.toFloat()
    val h = img.height.toFloat()
    if (w <= 0f || h <= 0f) return
    val values = FloatArray(9)
    photoMatrix.getValues(values)
    var scale = values[Matrix.MSCALE_X]
    val maxScale = minPhotoScale * 4f
    if (scale < minPhotoScale || scale > maxScale) {
      val target = scale.coerceIn(minPhotoScale, maxScale)
      photoMatrix.postScale(target / scale, target / scale, w / 2f, h / 2f)
      photoMatrix.getValues(values)
      scale = values[Matrix.MSCALE_X]
    }
    photoScale = scale
    val tx = values[Matrix.MTRANS_X]
    val ty = values[Matrix.MTRANS_Y]
    val ntx = tx.coerceIn(w - bmp.width * scale, 0f)
    val nty = ty.coerceIn(h - bmp.height * scale, 0f)
    photoMatrix.postTranslate(ntx - tx, nty - ty)
  }

  private fun pointerSpan(event: MotionEvent): Float {
    if (event.pointerCount < 2) return 0f
    val dx = event.getX(0) - event.getX(1)
    val dy = event.getY(0) - event.getY(1)
    return kotlin.math.hypot(dx.toDouble(), dy.toDouble()).toFloat()
  }

  private fun exportFramedPhoto(): File? {
    val bmp = photoBitmap
    val fallback = avatarFile?.takeIf { it.isFile }
    if (bmp == null || bmp.isRecycled) return fallback
    val img = findViewById<ImageView>(R.id.blyp_onboarding_photo)
    val vw = img.width
    val vh = img.height
    if (vw <= 0 || vh <= 0) return fallback
    val size = 512
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val draw = Matrix(photoMatrix)
    val s = size / vw.toFloat()
    draw.postScale(s, s)
    canvas.drawBitmap(bmp, draw, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    val file = File(cacheDir, "onboard-avatar-framed-${System.currentTimeMillis()}.jpg")
    return try {
      file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      file.takeIf { it.length() > 0 } ?: fallback
    } catch (_: Exception) {
      fallback
    } finally {
      out.recycle()
    }
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
          Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation) }, true)
        if (rotated != raw) raw.recycle()
        rotated
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun splitFullName(raw: String): Pair<String, String>? {
    val t = raw.trim().replace(Regex("\\s+"), " ")
    val space = t.indexOf(' ')
    if (space <= 0) return null
    val first = t.substring(0, space).trim()
    val last = t.substring(space + 1).trim()
    if (first.length < 2 || last.length < 2) return null
    return first to last
  }

  private fun openShell() {
    clearDraft()
    startActivity(
      Intent(this, BlypNativeShellActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      },
    )
    finish()
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

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  override fun onDestroy() {
    photoBitmap?.let { if (!it.isRecycled) it.recycle() }
    photoBitmap = null
    super.onDestroy()
  }

  companion object {
    private const val DRAFT_PREFS = "blyp_onboarding_draft"
    private const val DRAFT_STEP = "step"
    private const val DRAFT_NAME = "name"
    private const val DRAFT_PHOTO = "photo"
    private const val DRAFT_MATRIX = "matrix"

    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellNativeOnboardingActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        },
      )
    }
  }
}
