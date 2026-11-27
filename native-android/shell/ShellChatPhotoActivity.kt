package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.haroldndougou.blyp.R
import kotlin.math.abs

/** Photos du chat en grand. Le doigt fait glisser la suivante sans trou noir. */
class ShellChatPhotoActivity : AppCompatActivity() {
  private lateinit var image: ImageView
  private lateinit var incoming: ImageView
  private lateinit var busy: View
  private lateinit var error: TextView
  private var keys: ArrayList<String> = arrayListOf()
  private var locals: ArrayList<String> = arrayListOf()
  private var index = 0
  private var conv = ""
  private var generation = 0
  private var downX = 0f
  private var downY = 0f
  private var lastDx = 0f
  private var dragging = false
  private var waitingSlide = false
  private var dragDir = 0
  private var incomingIndex = -1
  private var sideToken = 0
  private var settle = false
  private var velocity: VelocityTracker? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.blyp_shell_chat_photo)
    image = findViewById(R.id.blyp_chat_photo_full)
    incoming = findViewById(R.id.blyp_chat_photo_incoming)
    busy = findViewById(R.id.blyp_chat_photo_busy)
    error = findViewById(R.id.blyp_chat_photo_error)
    conv = intent.getStringExtra(EXTRA_CONV).orEmpty()
    keys = intent.getStringArrayListExtra(EXTRA_KEYS) ?: arrayListOf(intent.getStringExtra(EXTRA_KEY).orEmpty())
    locals =
      intent.getStringArrayListExtra(EXTRA_LOCALS)
        ?: arrayListOf(intent.getStringExtra(EXTRA_LOCAL).orEmpty())
    index = intent.getIntExtra(EXTRA_INDEX, 0).coerceIn(0, (keys.size - 1).coerceAtLeast(0))
    findViewById<View>(R.id.blyp_chat_photo_root).setOnTouchListener { _, ev ->
      onPhotoTouch(ev)
      true
    }
    showStill(index)
  }

  private fun onPhotoTouch(ev: MotionEvent) {
    if (settle) return
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        velocity?.recycle()
        velocity = VelocityTracker.obtain()
        velocity?.addMovement(ev)
        downX = ev.x
        downY = ev.y
        lastDx = 0f
        dragging = false
        waitingSlide = false
        dragDir = 0
        image.animate().cancel()
        incoming.animate().cancel()
      }
      MotionEvent.ACTION_MOVE -> {
        velocity?.addMovement(ev)
        val dx = ev.x - downX
        lastDx = dx
        if (!dragging && abs(dx) > 18f && abs(dx) > abs(ev.y - downY)) {
          dragging = true
          val dir = if (dx < 0) 1 else -1
          val next = index + dir
          if (next in keys.indices) {
            dragDir = dir
            armIncoming(next)
          }
        }
        if (dragging && dragDir != 0) place(dx)
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        velocity?.addMovement(ev)
        velocity?.computeCurrentVelocity(1000)
        val vx = velocity?.xVelocity ?: 0f
        velocity?.recycle()
        velocity = null
        if (!dragging) {
          finish()
          return
        }
        val dx = ev.x - downX
        val go = dragDir != 0 && (abs(dx) > image.width * 0.22f || abs(vx) > 900f)
        if (!go) cancelSlide()
        else if (incoming.drawable != null) finishSlide()
        else {
          waitingSlide = true
          image.animate().translationX(0f).setDuration(120).start()
        }
      }
    }
  }

  private fun showStill(i: Int) {
    index = i
    generation++
    val token = generation
    val cached = peekAt(i)
    if (cached != null) {
      image.setImageBitmap(cached)
      busy.visibility = View.GONE
      error.visibility = View.GONE
    } else {
      busy.visibility = View.VISIBLE
      error.visibility = View.GONE
    }
    image.translationX = 0f
    incoming.visibility = View.INVISIBLE
    incoming.translationX = 0f
    loadInto(image, i, token, showBusy = cached == null)
    warm(i - 1)
    warm(i + 1)
  }

  private fun armIncoming(next: Int) {
    incomingIndex = next
    val cached = peekAt(next)
    if (cached != null) {
      incoming.setImageBitmap(cached)
      incoming.visibility = View.VISIBLE
      return
    }
    incoming.visibility = View.INVISIBLE
    val token = ++sideToken
    val app = applicationContext
    Thread {
        val bmp = decodeAt(app, next) ?: return@Thread
        incoming.post {
          if (isFinishing || token != sideToken || incomingIndex != next) return@post
          incoming.setImageBitmap(bmp)
          if (waitingSlide && incomingIndex == next) {
            waitingSlide = false
            dragDir = if (next > index) 1 else -1
            incoming.visibility = View.VISIBLE
            val w = image.width.toFloat().coerceAtLeast(1f)
            image.translationX = 0f
            incoming.translationX = if (dragDir > 0) w else -w
            finishSlide()
          } else if (dragging && dragDir != 0) {
            incoming.visibility = View.VISIBLE
            place(lastDx)
          }
        }
      }
      .start()
  }

  private fun place(dx: Float) {
    val w = image.width.toFloat().coerceAtLeast(1f)
    val limited = dx.coerceIn(-w, w)
    image.translationX = limited
    if (incoming.visibility == View.VISIBLE) {
      incoming.translationX = limited + if (dragDir > 0) w else -w
    }
  }

  private fun finishSlide() {
    val w = image.width.toFloat().coerceAtLeast(1f)
    val end = if (dragDir > 0) -w else w
    settle = true
    image.animate().translationX(end).setDuration(180).start()
    incoming.animate().translationX(0f).setDuration(180).withEndAction {
      val shown = incoming.drawable
      if (shown != null) image.setImageDrawable(shown)
      image.translationX = 0f
      incoming.visibility = View.INVISIBLE
      incoming.translationX = 0f
      incoming.setImageDrawable(null)
      settle = false
      dragging = false
      showStill(incomingIndex)
    }.start()
  }

  private fun cancelSlide() {
    settle = true
    image.animate().translationX(0f).setDuration(160).withEndAction { settle = false }.start()
    if (incoming.visibility == View.VISIBLE) {
      val w = image.width.toFloat()
      incoming.animate().translationX(if (dragDir > 0) w else -w).setDuration(160).withEndAction {
        incoming.visibility = View.INVISIBLE
      }.start()
    }
    dragging = false
  }

  private fun loadInto(target: ImageView, i: Int, token: Int, showBusy: Boolean) {
    val app = applicationContext
    Thread {
        val bmp = decodeAt(app, i)
        target.post {
          if (isFinishing || token != generation || index != i) return@post
          if (bmp != null) {
            target.setImageBitmap(bmp)
            if (target == image) {
              busy.visibility = View.GONE
              error.visibility = View.GONE
            }
          } else if (showBusy && target.drawable == null) {
            busy.visibility = View.GONE
            error.visibility = View.VISIBLE
          } else {
            busy.visibility = View.GONE
          }
        }
      }
      .start()
  }

  private fun warm(i: Int) {
    if (i !in keys.indices || peekAt(i) != null) return
    val app = applicationContext
    Thread { decodeAt(app, i) }.start()
  }

  private fun peekAt(i: Int): android.graphics.Bitmap? {
    if (i !in keys.indices) return null
    return BlypShellChatImageLoader.peek(keys[i])
      ?: BlypShellChatImageLoader.peek(locals.getOrNull(i))
  }

  private fun decodeAt(app: Context, i: Int): android.graphics.Bitmap? {
    if (i !in keys.indices) return null
    return BlypShellChatImageLoader.decodeBest(app, conv, keys[i], locals.getOrNull(i))
  }

  companion object {
    private const val EXTRA_CONV = "conv"
    private const val EXTRA_KEY = "key"
    private const val EXTRA_LOCAL = "local"
    private const val EXTRA_KEYS = "keys"
    private const val EXTRA_LOCALS = "locals"
    private const val EXTRA_INDEX = "index"

    fun start(
      context: Context,
      conversationId: String,
      imageKey: String?,
      localPath: String?,
    ) {
      start(context, conversationId, listOf(imageKey.orEmpty()), listOf(localPath.orEmpty()), 0)
    }

    fun start(
      context: Context,
      conversationId: String,
      imageKeys: List<String>,
      localPaths: List<String>,
      index: Int,
    ) {
      context.startActivity(
        Intent(context, ShellChatPhotoActivity::class.java).apply {
          putExtra(EXTRA_CONV, conversationId)
          putStringArrayListExtra(EXTRA_KEYS, ArrayList(imageKeys))
          putStringArrayListExtra(EXTRA_LOCALS, ArrayList(localPaths))
          putExtra(EXTRA_INDEX, index)
          putExtra(EXTRA_KEY, imageKeys.getOrNull(index).orEmpty())
          putExtra(EXTRA_LOCAL, localPaths.getOrNull(index).orEmpty())
        },
      )
    }
  }
}
