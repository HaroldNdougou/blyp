package com.haroldndougou.blyp.shell

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.app.Dialog
import android.content.res.Configuration
import android.os.Bundle
import android.widget.Toast
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.TextView
import androidx.fragment.app.DialogFragment
import com.haroldndougou.blyp.R
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Reçu transaction plein écran (aligné `PaymentReceiptScreen`). */
class ShellHistoryDetailDialog : DialogFragment() {
  override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    val theme =
      if (night) {
        android.R.style.Theme_Material_NoActionBar
      } else {
        android.R.style.Theme_Material_Light_NoActionBar
      }
    return Dialog(requireContext(), theme)
  }

  override fun onStart() {
    super.onStart()
    dialog?.window?.setLayout(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
    )
    dialog?.window?.setBackgroundDrawableResource(R.color.blyp_shell_bg)
  }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    @Suppress("DEPRECATION")
    val row = arguments?.getSerializable(ARG_ROW) as? ShellHistoryRow
      ?: return View(requireContext())
    val root = inflater.inflate(R.layout.blyp_shell_history_detail, container, false)
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val isReceived = row.type == "received"

    root.findViewById<TextView>(R.id.blyp_detail_title).setText(
      if (isReceived) R.string.blyp_shell_detail_title_received
      else R.string.blyp_shell_detail_title_sent,
    )
    root.findViewById<TextView>(R.id.blyp_detail_subtitle).setText(
      if (isReceived) R.string.blyp_shell_detail_subtitle_received
      else R.string.blyp_shell_detail_subtitle_sent,
    )
    root.findViewById<TextView>(R.id.blyp_detail_peer_label).setText(
      if (isReceived) R.string.blyp_shell_detail_peer_from
      else R.string.blyp_shell_detail_peer_to,
    )

    val amountView = root.findViewById<TextView>(R.id.blyp_detail_amount)
    amountView.text =
      (if (isReceived) "+ " else "") + amountFmt.format(row.amountFcfa)
    amountView.setTextColor(
      requireContext().getColor(
        if (isReceived) R.color.blyp_shell_success_amount
        else R.color.blyp_shell_accent,
      ),
    )

    root.findViewById<TextView>(R.id.blyp_detail_name).text = row.name
    val phoneRow = root.findViewById<View>(R.id.blyp_detail_phone_row)
    val phoneDivider = root.findViewById<View>(R.id.blyp_detail_phone_divider)
    val phoneView = root.findViewById<TextView>(R.id.blyp_detail_phone)
    if (row.counterpartyPhone.isNullOrBlank()) {
      phoneRow.visibility = View.GONE
      phoneDivider.visibility = View.GONE
    } else {
      phoneRow.visibility = View.VISIBLE
      phoneDivider.visibility = View.VISIBLE
      val phoneLabel = formatPhoneDisplay(row.counterpartyPhone)
      phoneView.text = phoneLabel
      val copyPhone = {
        val cm =
          requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val digits = row.counterpartyPhone!!.replace(Regex("\\D"), "")
        cm.setPrimaryClip(ClipData.newPlainText("blyp_phone", digits))
        Toast.makeText(
          requireContext(),
          R.string.blyp_shell_phone_copied,
          Toast.LENGTH_SHORT,
        ).show()
      }
      phoneView.setOnClickListener { copyPhone() }
      phoneRow.setOnClickListener { copyPhone() }
    }
    root.findViewById<TextView>(R.id.blyp_detail_date).text =
      formatDetailDateTime(row.createdAt, locale)
    val profile = BlypShellSession.profile(requireContext())
    val balanceView = root.findViewById<TextView>(R.id.blyp_detail_balance)
    if (profile != null && profile.balanceFcfa >= 0) {
      balanceView.text =
        "${amountFmt.format(profile.balanceFcfa)} ${getString(R.string.blyp_shell_history_fcfa)}"
    } else {
      root.findViewById<View>(R.id.blyp_detail_balance_row).visibility = View.GONE
    }
    val refRow = root.findViewById<View>(R.id.blyp_detail_ref_row)
    val refDivider = root.findViewById<View>(R.id.blyp_detail_ref_divider)
    if (row.reference.isNullOrBlank()) {
      refRow.visibility = View.GONE
      refDivider.visibility = View.GONE
    } else {
      refRow.visibility = View.VISIBLE
      refDivider.visibility = View.VISIBLE
      val refView = root.findViewById<TextView>(R.id.blyp_detail_ref)
      val refText = row.reference!!.trim()
      refView.text = refText
      val copyRef = {
        val cm =
          requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("blyp_ref", refText))
        Toast.makeText(
          requireContext(),
          R.string.blyp_shell_detail_ref_copied,
          Toast.LENGTH_SHORT,
        ).show()
      }
      refView.setOnClickListener { copyRef() }
      refRow.setOnClickListener { copyRef() }
    }
    root.findViewById<View>(R.id.blyp_detail_close).setOnClickListener { dismiss() }
    root.findViewById<View>(R.id.blyp_detail_share).setOnClickListener {
      shareReceipt(row, isReceived, locale, amountFmt)
    }
    return root
  }

  private fun shareReceipt(
    row: ShellHistoryRow,
    isReceived: Boolean,
    locale: Locale,
    amountFmt: NumberFormat,
  ) {
    val amountLabel = amountFmt.format(row.amountFcfa)
    val dateLabel = formatDetailDateTime(row.createdAt, locale)
    val body =
      if (isReceived) {
        getString(R.string.blyp_shell_detail_share_received, amountLabel, row.name, dateLabel)
      } else {
        getString(R.string.blyp_shell_detail_share_sent, amountLabel, row.name, dateLabel)
      }
    val ref = row.reference?.trim().orEmpty()
    val text = if (ref.isNotEmpty()) "$body\n$ref" else body
    val intent =
      android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_SUBJECT, getString(R.string.blyp_shell_detail_share_title))
        putExtra(android.content.Intent.EXTRA_TEXT, text)
      }
    startActivity(android.content.Intent.createChooser(intent, getString(R.string.blyp_shell_detail_share)))
  }

  companion object {
    private const val ARG_ROW = "row"

    fun show(host: HistoryShellFragment, row: ShellHistoryRow) {
      ShellHistoryDetailDialog()
        .apply {
          arguments =
            Bundle().apply {
              putSerializable(ARG_ROW, row)
            }
        }
        .show(host.childFragmentManager, "blyp_history_detail")
    }

    private fun formatPhoneDisplay(digits: String): String {
      val d = digits.replace(Regex("\\D"), "")
      if (d.length <= 3) return d
      if (d.length <= 6) return "${d.take(3)} ${d.drop(3)}"
      val body = "${d.take(3)} ${d.drop(3).take(3)} ${d.drop(6)}"
      return if (d.startsWith("237") || d.length == 9) "+237 $body" else body
    }

    private fun formatDetailDateTime(iso: String, locale: Locale): String {
      return runCatching {
        val instant = Instant.parse(iso)
        val zdt = instant.atZone(ZoneId.systemDefault())
        val dateFmt = DateTimeFormatter.ofPattern("d MMM yyyy", locale)
        val timeFmt = DateTimeFormatter.ofPattern("HH:mm", locale)
        "${dateFmt.format(zdt)} · ${timeFmt.format(zdt)}"
      }.getOrDefault(iso)
    }
  }
}
