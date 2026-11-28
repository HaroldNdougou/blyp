package com.haroldndougou.blyp.shell

import android.text.InputFilter
import android.widget.EditText

/** Motif de paiement — plafond généreux, jamais infini. */
object BlypShellPayMotif {
  const val MAX_LEN = 150

  fun sanitize(raw: CharSequence?): String? =
    raw?.toString()?.trim()?.replace(Regex("\\s+"), " ")?.take(MAX_LEN)?.ifEmpty { null }

  fun bind(field: EditText) {
    field.filters = arrayOf(InputFilter.LengthFilter(MAX_LEN))
    field.maxLines = 3
  }
}
