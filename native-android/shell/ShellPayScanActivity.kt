package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Size
import android.view.View
import android.widget.ImageView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.TorchState
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.haroldndougou.blyp.R
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Scan QR de paiement (calque `app/pay-scan.tsx`) — résultat remis à Payer via [BlypShellPayQr]. */
class ShellPayScanActivity : AppCompatActivity() {
  private val analysisExecutor: ExecutorService =
    ThreadPoolExecutor(
      1,
      1,
      0L,
      TimeUnit.MILLISECONDS,
      LinkedBlockingQueue(),
      ThreadPoolExecutor.DiscardPolicy(),
    )
  private var cameraProvider: ProcessCameraProvider? = null
  private var scanner: BarcodeScanner? = null
  private val handled = AtomicBoolean(false)
  private var invalidDialog: android.app.Dialog? = null
  private val main = android.os.Handler(android.os.Looper.getMainLooper())

  private var permissionAskedAt = 0L
  private val cameraPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) {
        showCamera()
        return@registerForActivityResult
      }
      if (android.os.SystemClock.elapsedRealtime() - permissionAskedAt < BLOCKED_REPLY_MS) openAppSettings()
      finish()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.blyp_shell_pay_scan)
    WindowCompat.setDecorFitsSystemWindows(window, true)
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_scan_bg)
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = false
    findViewById<View>(R.id.blyp_scan_cancel).setOnClickListener { finish() }
    findViewById<View>(R.id.blyp_scan_back).setOnClickListener { finish() }
    if (hasCamera()) {
      showCamera()
    } else {
      permissionAskedAt = android.os.SystemClock.elapsedRealtime()
      cameraPermission.launch(Manifest.permission.CAMERA)
    }
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    invalidDialog?.dismiss()
    invalidDialog = null
    runCatching { cameraProvider?.unbindAll() }
    cameraProvider = null
    scanner?.close()
    scanner = null
    super.onDestroy()
    analysisExecutor.shutdown()
  }

  private fun hasCamera(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
      PackageManager.PERMISSION_GRANTED

  private fun openAppSettings() {
    runCatching {
      startActivity(
        Intent(
          android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          android.net.Uri.fromParts("package", packageName, null),
        ),
      )
    }
  }

  private fun showCamera() {
    val previewView = findViewById<PreviewView>(R.id.blyp_scan_preview)
    val options =
      BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    val barcode = BarcodeScanning.getClient(options)
    scanner = barcode
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener(
      {
        if (isFinishing || isDestroyed) return@addListener
        val provider = runCatching { future.get() }.getOrNull() ?: return@addListener
        cameraProvider = provider
        val preview =
          Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val analysis =
          ImageAnalysis.Builder()
            .setTargetResolution(Size(1280, 720))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
        analysis.setAnalyzer(analysisExecutor) { proxy -> analyze(barcode, proxy) }
        val camera =
          runCatching {
            provider.unbindAll()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
          }.getOrNull()
        if (camera != null) bindTorch(camera)
      },
      ContextCompat.getMainExecutor(this),
    )
  }

  private fun bindTorch(camera: Camera) {
    val button = findViewById<ImageView>(R.id.blyp_scan_torch)
    if (!camera.cameraInfo.hasFlashUnit()) {
      button.visibility = View.GONE
      return
    }
    button.visibility = View.VISIBLE
    camera.cameraInfo.torchState.observe(this) { state -> renderTorch(button, state == TorchState.ON) }
    button.setOnClickListener {
      val on = camera.cameraInfo.torchState.value == TorchState.ON
      renderTorch(button, !on)
      camera.cameraControl.enableTorch(!on)
    }
  }

  private fun renderTorch(button: ImageView, on: Boolean) {
    button.setImageResource(
      if (on) R.drawable.blyp_shell_scan_torch_on else R.drawable.blyp_shell_scan_torch_off,
    )
    button.setBackgroundResource(
      if (on) R.drawable.blyp_shell_scan_round_on else R.drawable.blyp_shell_scan_round,
    )
    button.contentDescription =
      getString(if (on) R.string.blyp_shell_scan_torch_off else R.string.blyp_shell_scan_torch_on)
  }

  @OptIn(ExperimentalGetImage::class)
  private fun analyze(barcode: BarcodeScanner, proxy: ImageProxy) {
    if (handled.get() || analysisExecutor.isShutdown) {
      proxy.close()
      return
    }
    val media = proxy.image
    if (media == null) {
      proxy.close()
      return
    }
    val input = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
    barcode
      .process(input)
      .addOnSuccessListener(ContextCompat.getMainExecutor(this)) { codes ->
        if (handled.get() || isFinishing || isDestroyed) return@addOnSuccessListener
        val raw = codes.firstOrNull { !it.rawValue.isNullOrBlank() }?.rawValue ?: return@addOnSuccessListener
        val payload = BlypShellPayQr.parse(raw)
        if (!handled.compareAndSet(false, true)) return@addOnSuccessListener
        main.post {
          if (isFinishing) return@post
          if (payload == null) {
            showInvalid(raw)
            return@post
          }
          BlypShellPayQr.setPending(payload)
          finish()
        }
      }
      .addOnCompleteListener { proxy.close() }
  }

  private fun showInvalid(raw: String) {
    if (invalidDialog?.isShowing == true) return
    val dialog =
      BlypShellDialogs.alertBuilder(this)
        .setTitle(R.string.blyp_shell_scan_title)
        .setMessage(getString(R.string.blyp_shell_scan_invalid) + "\n\n" + raw.take(140))
        .setPositiveButton(android.R.string.ok, null)
        .create()
    invalidDialog = dialog
    dialog.setOnDismissListener {
      invalidDialog = null
      handled.set(false)
    }
    dialog.show()
  }

  companion object {
    private const val BLOCKED_REPLY_MS = 450L

    fun start(context: Context) {
      context.startActivity(
        Intent(context, ShellPayScanActivity::class.java).apply {
          if (context !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
  }
}
