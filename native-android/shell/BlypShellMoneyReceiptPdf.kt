package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import java.io.File
import java.io.FileOutputStream
import java.text.NumberFormat
import java.util.Locale

object BlypShellMoneyReceiptPdf {
  data class Draft(
    val transferId: String,
    val amountFcfa: Int,
    val clientName: String,
    val reason: String,
    val stamp: ShellCommerceStamp,
  )

  fun generate(context: Context, draft: Draft): File? {
    val transferId = draft.transferId.trim()
    if (transferId.isEmpty()) return null
    val doc = PdfDocument()
    val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
    val page = doc.startPage(pageInfo)
    val c = page.canvas
    val french = Locale.getDefault().language == "fr"
    val title = context.getString(R.string.blyp_shell_receipt_blyp_title)
    val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.DKGRAY
      textSize = 18f
      isFakeBoldText = true
    }
    val body = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.DKGRAY
      textSize = 11f
    }
    var y = 72f
    c.drawText(title, 48f, y, bold)
    y += 28f
    val merchant =
      listOf(draft.stamp.line1, draft.stamp.line2).filter { it.isNotBlank() }.joinToString(" · ")
    if (merchant.isNotEmpty()) {
      c.drawText(merchant, 48f, y, bold.apply { textSize = 13f })
      y += 24f
    }
    val amountFmt =
      NumberFormat.getInstance(if (french) Locale.FRANCE else Locale.US)
        .format(draft.amountFcfa.coerceAtLeast(0))
    val fcfa = context.getString(R.string.blyp_shell_fcfa_label)
    y += 8f
    c.drawText(
      "${context.getString(R.string.blyp_shell_receipt_blyp_client)}: ${draft.clientName.trim()}",
      48f,
      y,
      body,
    )
    y += 18f
    c.drawText(
      "${context.getString(R.string.blyp_shell_receipt_blyp_amount)}: $amountFmt $fcfa",
      48f,
      y,
      bold.apply { textSize = 12f },
    )
    y += 18f
    if (draft.reason.trim().isNotEmpty()) {
      c.drawText(
        "${context.getString(R.string.blyp_shell_receipt_blyp_reason)}: ${draft.reason.trim()}",
        48f,
        y,
        body,
      )
      y += 18f
    }
    val date =
      java.text.DateFormat.getDateTimeInstance(
        java.text.DateFormat.SHORT,
        java.text.DateFormat.SHORT,
        if (french) Locale.FRANCE else Locale.getDefault(),
      ).format(java.util.Date())
    c.drawText("${context.getString(R.string.blyp_shell_receipt_blyp_date)}: $date", 48f, y, body)
    y += 18f
    c.drawText(
      "${context.getString(R.string.blyp_shell_receipt_blyp_ref)}: $transferId",
      48f,
      y,
      body,
    )
    y += 28f
    c.drawText(context.getString(R.string.blyp_shell_receipt_blyp_signed), 48f, y, body)
    doc.finishPage(page)
    val out = File(context.cacheDir, "blyp-mt-$transferId.pdf")
    return try {
      FileOutputStream(out).use { doc.writeTo(it) }
      doc.close()
      out
    } catch (_: Exception) {
      doc.close()
      null
    }
  }

  fun receiptDisplayName(context: Context, amountFcfa: Int, clientName: String): String {
    val amount =
      NumberFormat.getInstance(Locale.FRANCE).format(amountFcfa.coerceAtLeast(0)) + " F"
    val client = clientName.trim().ifEmpty { context.getString(R.string.blyp_shell_receipt_default_name) }
    return context.getString(R.string.blyp_shell_receipt_blyp_auto_name, amount, client)
  }
}