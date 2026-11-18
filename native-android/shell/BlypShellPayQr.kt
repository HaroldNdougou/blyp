package com.haroldndougou.blyp.shell

import android.net.Uri
import android.util.Log

/** QR de paiement Blyp (calque `lib/pay/blypPayQr.ts`). */
object BlypShellPayQr {
  private val ACCOUNT_RE = Regex("^BLYP-[UC]-[0-9A-HJKMNP-TV-Z]{10}$")
  private val ACCOUNT_FIND = Regex("BLYP-[UC]-[0-9A-HJKMNP-TV-Z]{10}")

  data class Payload(
    val accountId: String,
    val name: String,
    val amountFcfa: Int?,
    /** taxi | shop | soa_car | other — uniquement si présent dans le QR (`c=`). */
    val category: String? = null,
    /** Téléphone 9 chiffres — uniquement si présent dans le QR (`p=`), sans réseau. */
    val phoneDigits: String? = null,
  )

  @Volatile private var pending: Payload? = null

  /** Contenu du QR (calque `buildBlypPayQrUrl`). */
  fun buildUrl(
    accountId: String,
    name: String,
    amountFcfa: Int? = null,
    category: String? = null,
    phoneDigits: String? = null,
  ): String {
    val id = normalizeAccount(accountId) ?: return ""
    val q = StringBuilder("v=1&a=").append(Uri.encode(id))
    val n = name.trim()
    if (n.isNotEmpty()) q.append("&n=").append(Uri.encode(n))
    if (amountFcfa != null && amountFcfa > 0) q.append("&m=").append(amountFcfa)
    val cat = normalizeCategory(category)
    if (cat != null) q.append("&c=").append(Uri.encode(cat))
    val phone = normalizePhone(phoneDigits)
    if (phone != null) q.append("&p=").append(phone)
    return "blyp://pay?$q"
  }

  fun setPending(payload: Payload?) {
    pending = payload
  }

  fun takePending(): Payload? {
    val p = pending
    pending = null
    return p
  }

  fun parse(raw: String?): Payload? {
    val s = raw?.trim()?.trim('\uFEFF').orEmpty()
    if (s.isEmpty()) return null
    Log.i(TAG, "raw=${s.take(200)}")

    val params = extractParams(s)
    val accountId =
      normalizeAccount(params["a"] ?: params["account"] ?: params["accountId"])
        ?: ACCOUNT_FIND.find(s.uppercase())?.value?.let { normalizeAccount(it) }
        ?: return null

    val name = (params["n"] ?: params["name"] ?: "").trim()
    val amount =
      (params["m"] ?: params["amount"])
        ?.toDoubleOrNull()
        ?.toLong()
        ?.takeIf { it in 1..Int.MAX_VALUE }
        ?.toInt()
    val category = normalizeCategory(params["c"] ?: params["category"])
    val phone = normalizePhone(params["p"] ?: params["phone"] ?: params["phoneDigits"])
    Log.i(TAG, "ok id=$accountId cat=$category phone=$phone keys=${params.keys}")
    return Payload(accountId, name.ifEmpty { "—" }, amount, category, phone)
  }

  private fun extractParams(s: String): Map<String, String> {
    val q = s.indexOf('?')
    if (q >= 0) {
      val fromManual = parseQuery(s.substring(q + 1))
      if (fromManual.isNotEmpty()) return fromManual
    }
    if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s) ||
      s.lowercase().startsWith("blyp:")
    ) {
      val uri = runCatching { Uri.parse(s) }.getOrNull()
      if (uri != null) {
        val out = HashMap<String, String>()
        for (name in uri.queryParameterNames) {
          val v = uri.getQueryParameter(name) ?: continue
          out[name] = v
        }
        if (out.isEmpty()) out.putAll(parseQuery(uri.encodedQuery.orEmpty()))
        if (out.isNotEmpty()) return out
      }
    }
    return emptyMap()
  }

  private fun parseQuery(q: String): Map<String, String> {
    val out = HashMap<String, String>()
    if (q.isEmpty()) return out
    for (part in q.split("&")) {
      if (part.isEmpty()) continue
      val eq = part.indexOf('=')
      val k = uriDecode(if (eq >= 0) part.substring(0, eq) else part)
      val v = uriDecode(if (eq >= 0) part.substring(eq + 1) else "")
      if (k.isNotEmpty()) out[k] = v
    }
    return out
  }

  private fun uriDecode(value: String): String =
    runCatching { Uri.decode(value) }.getOrDefault(value)

  /** Crockford seulement sur le code à 10 caractères — pas sur BLYP-U/C. */
  private fun normalizeAccount(raw: String?): String? {
    val cleaned =
      raw?.trim()
        ?.filter { it.code in 32..126 }
        ?.uppercase()
        .orEmpty()
    if (cleaned.isEmpty()) return null
    val m = Regex("^BLYP-([UC])-([A-Z0-9]{10})$").matchEntire(cleaned) ?: return null
    val kind = m.groupValues[1]
    val code =
      m.groupValues[2]
        .replace('O', '0')
        .replace('I', '1')
        .replace('L', '1')
    val id = "BLYP-$kind-$code"
    return if (ACCOUNT_RE.matches(id)) id else null
  }

  /** Uniquement la valeur `c=` du QR — jamais déduite du nom. */
  fun normalizeCategory(raw: String?): String? =
    when (raw?.trim()?.lowercase()) {
      "taxi" -> "taxi"
      "shop", "boutique", "restaurant" -> "shop"
      "soa_car", "soa" -> "soa_car"
      "street", "rue" -> "street"
      "other", "autre" -> "other"
      else -> null
    }

  fun normalizePhone(raw: String?): String? {
    val d = raw?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty()
    return if (d.length == 9 && d[0] == '6') d else null
  }

  private const val TAG = "BlypShellPayQr"
}
