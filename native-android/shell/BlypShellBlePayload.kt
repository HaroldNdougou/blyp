package com.haroldndougou.blyp.shell

/** Payload manufacturer BLE — aligné `lib/ble/payload.ts`. */
object BlypShellBlePayload {
  private const val USER_PREFIX = "BLYP-U-"
  private const val COMMERCE_PREFIX = "BLYP-C-"
  private const val MAGIC0 = 0x42
  private const val MAGIC_USER = 0x50
  private const val MAGIC_COMMERCE = 0x43
  private const val CODE_LEN = 10
  private const val PHONE_LEN = 9

  fun encodeManufBytes(
    accountId: String,
    phone: String,
    category: String?,
  ): ByteArray? {
    val parsed = accountIdToCode(accountId) ?: return null
    val phone9 = normalizePhoneDigits(phone) ?: return null
    val magic1 = if (parsed.second == "commerce") MAGIC_COMMERCE else MAGIC_USER
    val out = ArrayList<Byte>(24)
    out.add(MAGIC0.toByte())
    out.add(magic1.toByte())
    for (c in parsed.first) out.add(c.code.toByte())
    for (c in phone9) out.add(c.code.toByte())
    categoryToByte(category)?.let { out.add(it) }
    return out.toByteArray()
  }

  private fun categoryToByte(category: String?): Byte? =
    when (category?.trim()) {
      "taxi" -> 0x54
      "shop" -> 0x53
      "other" -> 0x4f
      "street" -> 0x52
      "soa_car" -> 0x41
      else -> null
    }

  private fun accountIdToCode(accountId: String): Pair<String, String>? {
    val id = accountId.trim().uppercase()
    val kind: String
    val code: String
    when {
      id.startsWith(USER_PREFIX) -> {
        kind = "user"
        code = id.removePrefix(USER_PREFIX)
      }
      id.startsWith(COMMERCE_PREFIX) -> {
        kind = "commerce"
        code = id.removePrefix(COMMERCE_PREFIX)
      }
      else -> return null
    }
    if (!Regex("^[0-9A-HJKMNP-TV-Z]{10}$").matches(code)) return null
    return code to kind
  }

  private fun normalizePhoneDigits(phone: String): String? {
    val d = phone.replace(Regex("\\D"), "")
    val last9 = if (d.length >= 9) d.takeLast(9) else d
    if (!Regex("^6\\d{8}$").matches(last9)) return null
    return last9
  }

  const val COMPANY_ID = 0x0b1b
  private const val NAME_PREFIX = "BLYP"
  private const val BINARY_LEN = 2 + CODE_LEN + PHONE_LEN
  private val CODE_RE = Regex("^[0-9A-HJKMNP-TV-Z]{10}$")
  private val PHONE_RE = Regex("^6\\d{8}$")
  private val ASCII_ID_RE = Regex("BLYP(?:\\|[0-9A-HJKMNP-TV-Z]{10}\\|\\d{9})?", RegexOption.IGNORE_CASE)

  data class Decoded(
    val accountId: String,
    val phoneDigits: String,
    val displayName: String,
    val category: String?,
    val rssi: Int,
  )

  private fun byteToCategory(b: Int?): String? =
    when (b) {
      0x54 -> "taxi"
      0x53 -> "shop"
      0x4f -> "other"
      0x52 -> "street"
      0x41 -> "soa_car"
      else -> null
    }

  private fun peerFromCodePhone(
    code: String,
    phone9: String,
    rssi: Int,
    kind: String,
    category: String?,
  ): Decoded? {
    if (!CODE_RE.matches(code) || !PHONE_RE.matches(phone9)) return null
    val tag = code.takeLast(4)
    val accountId = (if (kind == "commerce") COMMERCE_PREFIX else USER_PREFIX) + code.uppercase()
    val resolved = category ?: if (kind == "user") "taxi" else null
    val displayName =
      when {
        kind == "commerce" -> "Pro $tag"
        resolved == "other" -> "Blyp $tag"
        else -> "Taxi $tag"
      }
    return Decoded(accountId, phone9, displayName, resolved, rssi)
  }

  private fun readAscii(bytes: ByteArray, start: Int, len: Int): String {
    val sb = StringBuilder(len)
    for (i in 0 until len) {
      val b = bytes.getOrNull(start + i)?.toInt()?.and(0xff) ?: return ""
      if (b < 0x20 || b > 0x7e) return ""
      sb.append(b.toChar())
    }
    return sb.toString()
  }

  private fun decodeBinary(bytes: ByteArray, offset: Int, rssi: Int): Decoded? {
    if (bytes.size - offset < BINARY_LEN) return null
    if (bytes[offset].toInt() and 0xff != MAGIC0) return null
    val kind =
      when (bytes[offset + 1].toInt() and 0xff) {
        MAGIC_USER -> "user"
        MAGIC_COMMERCE -> "commerce"
        else -> return null
      }
    val code = readAscii(bytes, offset + 2, CODE_LEN)
    val phone = readAscii(bytes, offset + 2 + CODE_LEN, PHONE_LEN)
    val extra = bytes.getOrNull(offset + BINARY_LEN)?.toInt()?.and(0xff)
    return peerFromCodePhone(code, phone, rssi, kind, byteToCategory(extra))
  }

  private fun asciiFrom(bytes: ByteArray, start: Int = 0): String {
    val sb = StringBuilder()
    for (i in start until bytes.size) {
      val c = bytes[i].toInt() and 0xff
      if (c in 0x20..0x7e) sb.append(c.toChar())
    }
    return sb.toString().trim()
  }

  /** Nom « BLYP|CODE|PHONE » (le repli compte démo du JS n’est pas repris). */
  private fun parseName(localName: String?, rssi: Int): Decoded? {
    val raw = localName?.trim().orEmpty()
    if (raw.isEmpty()) return null
    val idx = raw.uppercase().indexOf(NAME_PREFIX)
    if (idx < 0) return null
    val rest = raw.substring(idx + NAME_PREFIX.length).trim().replace(Regex("^[|:\\-\\s]+"), "")
    val parts = rest.split(Regex("[|:\\s]+")).filter { it.isNotEmpty() }
    if (parts.size < 2) return null
    val rawCode = parts[0].uppercase()
    var kind = "user"
    val code =
      when {
        rawCode.startsWith(COMMERCE_PREFIX) -> {
          kind = "commerce"
          rawCode.removePrefix(COMMERCE_PREFIX)
        }
        rawCode.startsWith(USER_PREFIX) -> rawCode.removePrefix(USER_PREFIX)
        rawCode.startsWith("C-") -> {
          kind = "commerce"
          rawCode.removePrefix("C-")
        }
        rawCode.startsWith("U-") -> rawCode.removePrefix("U-")
        else -> rawCode
      }
    val phone = parts[1].replace(Regex("\\D"), "").takeLast(9)
    return peerFromCodePhone(code, phone, rssi, kind, null)
  }

  /** Calque de `resolveTaxiFromScan` (nom → manufacturer → trame brute). */
  fun decodeFromScan(
    localName: String?,
    manufBytes: ByteArray?,
    rawRecord: ByteArray?,
    rssi: Int,
  ): Decoded? {
    parseName(localName, rssi)?.let { return it }
    if (manufBytes != null && manufBytes.size >= 2) {
      decodeBinary(manufBytes, 0, rssi)?.let { return it }
      ASCII_ID_RE.find(asciiFrom(manufBytes))?.let { m -> parseName(m.value, rssi)?.let { return it } }
    }
    if (rawRecord != null) {
      var i = 0
      while (i + BINARY_LEN <= rawRecord.size) {
        decodeBinary(rawRecord, i, rssi)?.let { return it }
        i++
      }
      ASCII_ID_RE.find(asciiFrom(rawRecord))?.let { m -> parseName(m.value, rssi)?.let { return it } }
    }
    return null
  }
}
