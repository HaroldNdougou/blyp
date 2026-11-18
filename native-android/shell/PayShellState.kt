package com.haroldndougou.blyp.shell

/** Clavier Pay natif (coque) — indépendant du cold start overlay. */
object PayShellState {
  private const val MAX_DIGITS = 6
  private val digits = StringBuilder()

  @Synchronized
  fun appendDigit(d: Char) {
    if (!d.isDigit()) return
    if (digits.isEmpty() && d == '0') return
    if (digits.length >= MAX_DIGITS) return
    if (digits.toString() == "0") digits.clear()
    digits.append(d)
  }

  @Synchronized
  fun backspace() {
    if (digits.isEmpty()) return
    digits.deleteCharAt(digits.length - 1)
  }

  @Synchronized
  fun digitsString(): String = digits.toString()

  @Synchronized
  fun amountFcfa(): Int = digits.toString().toIntOrNull() ?: 0

  @Synchronized
  fun clearDigits() {
    digits.clear()
  }

  @Synchronized
  fun setAmountFcfa(value: Int) {
    digits.clear()
    if (value <= 0) return
    digits.append(value.coerceAtMost(999_999).toString())
  }

  @Synchronized
  fun queuePay(): Int {
    val n = amountFcfa()
    return if (n > 0) n else 0
  }

  @Synchronized
  fun formatDisplay(): String {
    val raw = digits.toString()
    if (raw.isEmpty()) return "0"
    val reversed = raw.reversed()
    val grouped = StringBuilder()
    for (i in reversed.indices) {
      if (i > 0 && i % 3 == 0) grouped.append('\u202f')
      grouped.append(reversed[i])
    }
    return grouped.reverse().toString()
  }
}
