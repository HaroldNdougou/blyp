package com.haroldndougou.blyp.shell

import android.app.Dialog
import android.content.Context
import android.content.DialogInterface
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.haroldndougou.blyp.R

/** Toutes les boîtes (titre, message, choix, code) partagent le même look. */
object BlypShellDialogs {
  fun alertBuilder(context: Context): Builder = Builder(context)

  class Builder(private val context: Context) {
    private var title: CharSequence? = null
    private var message: CharSequence? = null
    private var cancelable = true
    private var onCancel: DialogInterface.OnCancelListener? = null
    private var customView: View? = null
    private var items: Array<out CharSequence>? = null
    private var itemListener: DialogInterface.OnClickListener? = null
    private val buttons = ArrayList<ButtonSpec>(3)

    fun setTitle(titleId: Int): Builder {
      title = context.getText(titleId)
      return this
    }

    fun setTitle(title: CharSequence?): Builder {
      this.title = title
      return this
    }

    fun setMessage(messageId: Int): Builder {
      message = context.getText(messageId)
      return this
    }

    fun setMessage(message: CharSequence?): Builder {
      this.message = message
      return this
    }

    fun setCancelable(cancelable: Boolean): Builder {
      this.cancelable = cancelable
      return this
    }

    fun setOnCancelListener(listener: DialogInterface.OnCancelListener?): Builder {
      onCancel = listener
      return this
    }

    fun setView(view: View?): Builder {
      customView = view
      return this
    }

    fun setItems(
      items: Array<out CharSequence>?,
      listener: DialogInterface.OnClickListener?,
    ): Builder {
      this.items = items
      itemListener = listener
      return this
    }

    fun setPositiveButton(
      textId: Int,
      listener: DialogInterface.OnClickListener?,
    ): Builder = addButton(DialogInterface.BUTTON_POSITIVE, context.getText(textId), listener)

    fun setNegativeButton(
      textId: Int,
      listener: DialogInterface.OnClickListener?,
    ): Builder = addButton(DialogInterface.BUTTON_NEGATIVE, context.getText(textId), listener)

    fun setNeutralButton(
      textId: Int,
      listener: DialogInterface.OnClickListener?,
    ): Builder = addButton(DialogInterface.BUTTON_NEUTRAL, context.getText(textId), listener)

    fun create(): Dialog {
      val dialog = Dialog(context, R.style.BlypShellDialogTheme)
      val root = View.inflate(context, R.layout.blyp_shell_dialog, null)
      val titleView = root.findViewById<TextView>(R.id.blyp_dialog_title)
      val messageView = root.findViewById<TextView>(R.id.blyp_dialog_message)
      val custom = root.findViewById<FrameLayout>(R.id.blyp_dialog_custom)
      val itemBox = root.findViewById<LinearLayout>(R.id.blyp_dialog_items)
      val actions = root.findViewById<LinearLayout>(R.id.blyp_dialog_actions)

      val titleText = title?.toString()?.trim().orEmpty()
      if (titleText.isEmpty()) {
        titleView.visibility = View.GONE
      } else {
        titleView.text = titleText
      }
      val rawMessage = message
      val messageText = rawMessage?.toString()?.trim().orEmpty()
      if (messageText.isEmpty()) {
        messageView.visibility = View.GONE
      } else {
        messageView.text = if (rawMessage is android.text.Spanned) rawMessage else messageText
        if (titleText.isEmpty()) {
          (messageView.layoutParams as ViewGroup.MarginLayoutParams).topMargin = 0
        }
      }

      val extra = customView
      if (extra == null) {
        custom.visibility = View.GONE
      } else {
        (extra.parent as? ViewGroup)?.removeView(extra)
        styleField(extra)
        custom.visibility = View.VISIBLE
        custom.addView(
          extra,
          FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ),
        )
      }

      val choices = items
      if (choices.isNullOrEmpty()) {
        itemBox.visibility = View.GONE
      } else {
        itemBox.visibility = View.VISIBLE
        choices.forEachIndexed { index, label ->
          if (index > 0) {
            itemBox.addView(View(context).apply {
              layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                context.dp(1),
              )
              setBackgroundColor(ContextCompat.getColor(context, R.color.blyp_shell_border_light))
            })
          }
          itemBox.addView(TextView(context).apply {
            text = label
            gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(context, R.color.blyp_shell_text))
            textSize = 16f
            setPadding(0, context.dp(14), 0, context.dp(14))
            setOnClickListener {
              dialog.dismiss()
              itemListener?.onClick(dialog, index)
            }
          })
        }
      }

      val ordered = buttons.sortedBy {
        when (it.which) {
          DialogInterface.BUTTON_NEGATIVE -> 0
          DialogInterface.BUTTON_NEUTRAL -> 1
          else -> 2
        }
      }
      if (ordered.isEmpty()) {
        actions.visibility = View.GONE
      } else {
        ordered.forEachIndexed { index, spec ->
          actions.addView(button(dialog, spec, index > 0))
        }
      }

      dialog.setContentView(root)
      dialog.setCancelable(cancelable)
      dialog.setCanceledOnTouchOutside(cancelable)
      dialog.setOnCancelListener(onCancel)
      if (extra != null) {
        dialog.window?.setSoftInputMode(
          WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
        )
      }
      val dm = context.resources.displayMetrics
      val width = minOf((320 * dm.density).toInt(), dm.widthPixels - context.dp(56))
      val maxH = (dm.heightPixels * 0.8f).toInt()
      val card = root.findViewById<View>(R.id.blyp_dialog_card)
      card.measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
      )
      val height = minOf(card.measuredHeight, maxH).coerceAtLeast(context.dp(48))
      dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      dialog.setOnShowListener {
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.window?.setLayout(width, height)
      }
      dialog.window?.setLayout(width, height)
      return dialog
    }

    fun show(): Dialog = create().also { it.show() }

    private fun addButton(
      which: Int,
      text: CharSequence,
      listener: DialogInterface.OnClickListener?,
    ): Builder {
      buttons.removeAll { it.which == which }
      buttons.add(ButtonSpec(which, text, listener))
      return this
    }

    private fun button(dialog: Dialog, spec: ButtonSpec, gap: Boolean): TextView {
      val signOut = spec.text.toString() == context.getString(R.string.blyp_shell_sign_out_confirm)
      val delete =
        spec.text.toString() == context.getString(R.string.blyp_shell_status_delete_confirm)
      val destructive = signOut || delete
      val primary = spec.which == DialogInterface.BUTTON_POSITIVE && !destructive
      return TextView(context).apply {
        text = spec.text
        gravity = Gravity.CENTER
        textSize = 15f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        minHeight = context.dp(48)
        setPadding(context.dp(12), 0, context.dp(12), 0)
        setBackgroundResource(
          when {
            destructive -> R.drawable.blyp_shell_dialog_destructive
            primary -> R.drawable.blyp_shell_btn_primary_pill
            else -> R.drawable.blyp_shell_btn_secondary_pill
          },
        )
        setTextColor(
          ContextCompat.getColor(
            context,
            when {
              destructive -> R.color.blyp_shell_destructive
              primary -> R.color.blyp_shell_accent_on
              else -> R.color.blyp_shell_text
            },
          ),
        )
        layoutParams = LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          context.dp(48),
        ).apply { if (gap) topMargin = context.dp(10) }
        setOnClickListener {
          dialog.dismiss()
          spec.listener?.onClick(dialog, spec.which)
        }
      }
    }

    private fun styleField(view: View) {
      if (view !is EditText) return
      view.setTextColor(ContextCompat.getColor(context, R.color.blyp_shell_text))
      view.setHintTextColor(ContextCompat.getColor(context, R.color.blyp_shell_text_faint))
      view.background = GradientDrawable().apply {
        cornerRadius = context.dp(12).toFloat()
        setColor(ContextCompat.getColor(context, R.color.blyp_shell_input_bg))
        setStroke(context.dp(1), ContextCompat.getColor(context, R.color.blyp_shell_input_border))
      }
      val pad = context.dp(12)
      view.setPadding(pad, pad, pad, pad)
      view.gravity = Gravity.CENTER
      view.textSize = 20f
    }
  }

  private class ButtonSpec(
    val which: Int,
    val text: CharSequence,
    val listener: DialogInterface.OnClickListener?,
  )

  private fun Context.dp(value: Int): Int =
    (value * resources.displayMetrics.density).toInt()
}
