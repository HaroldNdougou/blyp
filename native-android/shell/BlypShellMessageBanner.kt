package com.haroldndougou.blyp.shell

import android.app.Activity
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R

/** Bannière en haut quand un message arrive et que la discussion n’est pas ouverte. */
object BlypShellMessageBanner {
  private const val TAG = "blyp_msg_banner"
  private val main = Handler(Looper.getMainLooper())

  fun chime(context: Context) {
    BlypShellChatSounds.playReceive(context)
  }

  fun show(context: Context, conversationId: String, name: String, body: String): Boolean {
    val act = BlypShellReceivedPill.foreground() ?: return false
    if (act.isFinishing) return false
    val title = name.trim().ifEmpty { "Blyp" }
    val text = body.trim().ifEmpty { title }
    main.post {
      if (act.isFinishing) return@post
      chime(act)
      attach(act, conversationId, title, text)
    }
    return true
  }

  private fun attach(activity: Activity, conversationId: String, name: String, body: String) {
    val parent = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
    parent.findViewWithTag<View>(TAG)?.let { parent.removeView(it) }
    val d = activity.resources.displayMetrics.density
    val card = LinearLayout(activity)
    card.tag = TAG
    card.orientation = LinearLayout.HORIZONTAL
    card.gravity = Gravity.CENTER_VERTICAL
    card.setPadding((12 * d).toInt(), (10 * d).toInt(), (14 * d).toInt(), (10 * d).toInt())
    card.background =
      GradientDrawable().apply {
        cornerRadius = 18 * d
        setColor(ContextCompat.getColor(activity, R.color.blyp_shell_surface))
      }
    card.elevation = 8 * d

    val letter = name.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
    val avatarBox = FrameLayout(activity)
    val initial = TextView(activity)
    initial.gravity = Gravity.CENTER
    initial.text = letter
    initial.setTextColor(ContextCompat.getColor(activity, R.color.blyp_shell_text))
    initial.textSize = 16f
    initial.setTypeface(initial.typeface, Typeface.BOLD)
    initial.background =
      GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ContextCompat.getColor(activity, R.color.blyp_shell_surface_muted))
      }
    val photo = ImageView(activity)
    photo.scaleType = ImageView.ScaleType.CENTER_CROP
    photo.background = initial.background
    photo.clipToOutline = true
    initial.clipToOutline = true
    val size = (40 * d).toInt()
    avatarBox.addView(initial, FrameLayout.LayoutParams(size, size))
    avatarBox.addView(photo, FrameLayout.LayoutParams(size, size))
    photo.visibility = View.GONE
    card.addView(avatarBox, LinearLayout.LayoutParams(size, size))

    val col = LinearLayout(activity)
    col.orientation = LinearLayout.VERTICAL
    val title = TextView(activity)
    title.text = name
    title.setTextColor(ContextCompat.getColor(activity, R.color.blyp_shell_text))
    title.textSize = 15f
    title.setTypeface(title.typeface, Typeface.BOLD)
    title.maxLines = 1
    val preview = TextView(activity)
    preview.text = body
    preview.setTextColor(ContextCompat.getColor(activity, R.color.blyp_shell_muted))
    preview.textSize = 14f
    preview.maxLines = 2
    col.addView(title)
    col.addView(preview)
    val colLp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    colLp.marginStart = (10 * d).toInt()
    card.addView(col, colLp)

    val lp =
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      )
    lp.gravity = Gravity.TOP
    val side = (10 * d).toInt()
    lp.leftMargin = side
    lp.rightMargin = side
    lp.topMargin = side + statusBar(activity)
    parent.addView(card, lp)
    card.translationY = -80 * d
    card.animate().translationY(0f).setDuration(260).start()

    val phone = BlypShellSession.phone(activity)
    val meta =
      if (phone.isNullOrBlank()) null
      else BlypShellChatMessagesStore.conversationMeta(activity, phone, conversationId)
    val peerPhone = meta?.optString("peerPhone").orEmpty()
    val avatarUrl =
      meta?.optString("peerAvatarUrl")?.trim().orEmpty().ifEmpty {
        BlypShellPeerAvatar.urlForPhone(activity, peerPhone).orEmpty()
      }
    if (avatarUrl.isNotEmpty()) {
      BlypShellAvatarLoader.loadInto(avatarUrl, photo, initial, letter)
    }

    val gone = Runnable { if (card.parent === parent) parent.removeView(card) }
    card.setOnClickListener {
      main.removeCallbacks(gone)
      gone.run()
      ShellChatThreadActivity.start(
        activity,
        conversationId,
        name,
        peerPhone.ifEmpty { null },
        avatarUrl.ifEmpty { null },
      )
    }
    main.postDelayed(gone, 3200L)
  }

  private fun statusBar(activity: Activity): Int {
    val id = activity.resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) activity.resources.getDimensionPixelSize(id) else 0
  }
}
