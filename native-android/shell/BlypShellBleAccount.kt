package com.haroldndougou.blyp.shell

import android.content.Context

/** Compte BLE commerce — aligné `resolveBleBroadcastAccount`. */
object BlypShellBleAccount {
  private val BLYP_PUBLIC = Regex("^BLYP-[UC]-[0-9A-HJKMNP-TV-Z]{10}$")
  private val UUID_RE = Regex("^[0-9A-F-]{36}$", RegexOption.IGNORE_CASE)
  private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  data class Account(
    val accountId: String,
    val phone: String,
    val category: String,
  )

  fun resolveCommerce(context: Context): Account? {
    if (!BlypShellSession.isCommerceMode(context)) return null
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return null
    val raw = BlypShellSession.accountId(context)?.trim().orEmpty()
    val accountId = normalizeBleAccountId(raw, "commerce") ?: return null
    val category =
      BlypShellCommerceSession.activeCommerceCategory(context)?.trim().orEmpty()
        .ifEmpty { "other" }
    return Account(accountId = accountId, phone = phone, category = category)
  }

  /** Pay perso — calqué `resolveP2pReceiveBroadcastAccount`. */
  fun resolvePersonal(context: Context): Account? {
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return null
    val raw = BlypShellSession.accountId(context)?.trim().orEmpty()
    val accountId = normalizeBleAccountId(raw, "user") ?: return null
    return Account(accountId = accountId, phone = phone, category = "other")
  }

  fun resolveForBroadcast(context: Context): Account? =
    if (BlypShellSession.isCommerceMode(context)) resolveCommerce(context)
    else resolvePersonal(context)

  private fun normalizeBleAccountId(raw: String, kind: String): String? {
    val id = raw.trim().uppercase()
    if (id.isEmpty()) return null
    if (BLYP_PUBLIC.matches(id)) return id
    if (UUID_RE.matches(id)) {
      return if (kind == "commerce") fallbackCommerceAccountId(id) else fallbackAccountId(id)
    }
    return null
  }

  private fun fallbackAccountId(userId: String): String {
    val hex =
      userId.replace("-", "").uppercase().replace(Regex("[^0-9A-F]"), "")
        .padEnd(20, '0')
        .take(20)
    val out = StringBuilder(10)
    for (i in 0 until 10) {
      val pair = hex.substring(i * 2, i * 2 + 2)
      val v = pair.toInt(16) % 32
      out.append(CROCKFORD[v])
    }
    return "BLYP-U-$out"
  }

  private fun fallbackCommerceAccountId(userId: String): String =
    fallbackAccountId(userId).replace("^BLYP-U-".toRegex(), "BLYP-C-")
}
