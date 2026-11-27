package com.haroldndougou.blyp.shell

object BlypShellFormat {
  fun fileSize(bytes: Long): String {
    val b = bytes.coerceAtLeast(0)
    if (b < 1024) return "$b o"
    if (b < 1024 * 1024) return "${b / 1024} ko"
    return String.format("%.1f Mo", b / (1024.0 * 1024.0))
  }
}