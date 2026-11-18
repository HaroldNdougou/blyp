package com.haroldndougou.blyp.shell

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/** Destinataire + PIN pour payer depuis la coque sans React. */
object BlypShellPayRuntime {
  private const val PREFS = "blyp_shell_pay_v1"
  private const val KEY_RECIPIENT = "recipient_json"
  private const val KEY_CANDIDATES = "candidates_json"
  private const val KEY_PIN = "transaction_pin"
  private const val KEY_BALANCE = "balance_fcfa"
  private const val KEY_LEGACY_REGULARS = "regulars_json"
  private const val KEY_STICKY_MIGRATED = "sticky_ble_migrated_v2"

  data class RecipientOption(
    val accountId: String,
    val name: String,
    val phoneDigits: String?,
    val category: String? = null,
    val fromQr: Boolean = false,
    /** Vu en BLE : vit seulement tant que le pair est détecté (calque RN, pas persisté). */
    val fromBle: Boolean = false,
  ) {
    fun toJson(): JSONObject =
      JSONObject().apply {
        put("accountId", accountId)
        put("name", name)
        put("phoneDigits", phoneDigits ?: JSONObject.NULL)
        if (!category.isNullOrBlank()) put("category", category)
        if (fromQr) put("fromQr", true)
        if (fromBle) put("fromBle", true)
      }
  }

  private fun prefs(context: Context) = BlypSecurePrefs.get(context, PREFS)

  /**
   * Le destinataire actif n’est posé que par Payer natif (BLE / QR / choix manuel) :
   * l’îlot RN ne doit pas ressusciter un ancien destinataire. Un PIN vide n’efface pas le PIN natif.
   */
  @Suppress("UNUSED_PARAMETER")
  fun sync(
    context: Context,
    recipientJson: String,
    candidatesJson: String,
    transactionPin: String,
    balanceFcfa: Int,
  ) {
    val pin = transactionPin.replace(Regex("\\D"), "")
    prefs(context).edit().apply {
      putString(KEY_CANDIDATES, candidatesJson.trim())
      remove(KEY_LEGACY_REGULARS)
      if (pin.length == 4) putString(KEY_PIN, pin)
      if (balanceFcfa >= 0) putInt(KEY_BALANCE, balanceFcfa)
      apply()
    }
    BlypShellPayDossierRam.invalidate()
    BlypShellPayDossierStore.refreshFromSources(context)
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
    BlypShellPayDossierStore.clear(context)
  }

  fun updateBalance(context: Context, balanceFcfa: Int) {
    if (balanceFcfa < 0) return
    BlypShellPayDossierRam.invalidate()
    prefs(context).edit().putInt(KEY_BALANCE, balanceFcfa).apply()
    BlypShellSession.updateBalance(context, balanceFcfa)
    BlypShellPayDossierStore.refreshFromSources(context)
  }

  fun clearActiveRecipient(context: Context) {
    prefs(context).edit().remove(KEY_RECIPIENT).apply()
    BlypShellPayDossierRam.invalidate()
  }

  /** Définit le destinataire actif (lookup téléphone ou nouveau proche). */
  fun applyRecipient(context: Context, option: RecipientOption) {
    val merged = LinkedHashMap<String, RecipientOption>()
    for (o in listCandidates(context)) {
      merged[o.accountId] = o
    }
    merged[option.accountId] = option
    val arr = JSONArray()
    for (o in merged.values) {
      arr.put(o.toJson())
    }
    prefs(context).edit().apply {
      putString(KEY_RECIPIENT, option.toJson().toString())
      putString(KEY_CANDIDATES, arr.toString())
      apply()
    }
    BlypShellPayDossierRam.invalidate()
  }

  fun listCandidates(context: Context): List<RecipientOption> {
    val raw = prefs(context).getString(KEY_CANDIDATES, "")?.trim().orEmpty()
    return parseCandidates(raw)
  }

  private fun parseCandidates(raw: String): List<RecipientOption> {
    if (raw.isBlank()) return emptyList()
    return runCatching {
      val arr = JSONArray(raw)
      val out = ArrayList<RecipientOption>()
      val seen = HashSet<String>()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val accountId = o.optString("accountId", "").trim()
        val name = o.optString("name", "").trim()
        if (accountId.isBlank() || name.isBlank() || !seen.add(accountId)) continue
        val phone =
          o.optString("phoneDigits", "").replace(Regex("\\D"), "").takeLast(9)
        val category = o.optString("category", "").trim().ifEmpty { null }
        out.add(
          RecipientOption(
            accountId = accountId,
            name = name,
            phoneDigits = phone.ifEmpty { null },
            category = category,
            fromQr = o.optBoolean("fromQr", false),
            fromBle = o.optBoolean("fromBle", false),
          ),
        )
      }
      out
    }.getOrDefault(emptyList())
  }

  data class Snapshot(
    val recipientJson: String,
    val transactionPin: String,
    val balanceFcfa: Int,
  )

  fun read(context: Context): Snapshot? {
    val p = prefs(context)
    val recipient = p.getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    val pin = p.getString(KEY_PIN, "")?.replace(Regex("\\D"), "").orEmpty()
    if (recipient.isBlank() || pin.length != 4) return null
    val accountId =
      runCatching { JSONObject(recipient).optString("accountId", "").trim() }
        .getOrDefault("")
    if (accountId.isBlank()) return null
    return Snapshot(
      recipientJson = recipient,
      transactionPin = pin,
      balanceFcfa = p.getInt(KEY_BALANCE, 0),
    )
  }

  fun recipientLabel(context: Context): String? = activeRecipientLabel(context)

  fun activeRecipientLabel(context: Context): String? {
    val raw = prefs(context).getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (raw.isBlank()) return null
    val name =
      runCatching { JSONObject(raw).optString("name", "").trim() }.getOrDefault("")
    return name.ifBlank { null }
  }

  fun activeRecipientPhone(context: Context): String? {
    val raw = prefs(context).getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (raw.isBlank()) return null
    val phone =
      runCatching { JSONObject(raw).optString("phoneDigits", "").trim() }
        .getOrDefault("")
    return phone.ifBlank { null }
  }

  fun activeRecipientAccountId(context: Context): String? {
    val raw = prefs(context).getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (raw.isBlank()) return null
    val id =
      runCatching { JSONObject(raw).optString("accountId", "").trim() }
        .getOrDefault("")
    return id.ifBlank { null }
  }

  fun activeRecipientCategory(context: Context): String? {
    val raw = prefs(context).getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (raw.isBlank()) return null
    return runCatching { JSONObject(raw).optString("category", "").trim() }
      .getOrDefault("")
      .ifBlank { null }
  }

  fun activeRecipientFromQr(context: Context): Boolean {
    val raw = prefs(context).getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (raw.isBlank()) return false
    return runCatching { JSONObject(raw).optBoolean("fromQr", false) }.getOrDefault(false)
  }

  fun activeRecipientFromBle(context: Context): Boolean {
    val raw = prefs(context).getString(KEY_RECIPIENT, "")?.trim().orEmpty()
    if (raw.isBlank()) return false
    return runCatching { JSONObject(raw).optBoolean("fromBle", false) }.getOrDefault(false)
  }

  /** Pair BLE parti (ou app relancée) : on retire le destinataire BLE, pas un QR ni un choix manuel. */
  fun clearBleRecipient(context: Context): Boolean {
    if (!activeRecipientFromBle(context)) return false
    clearActiveRecipient(context)
    return true
  }

  /** Délai fixe ; RAM seulement → perdu au relancement. */
  const val QR_HOLD_MS = 5 * 60_000L
  @Volatile private var qrHoldId: String? = null
  @Volatile private var qrHoldUntilMs = 0L

  fun holdQrRecipient(accountId: String) {
    qrHoldId = accountId.trim().uppercase()
    qrHoldUntilMs = System.currentTimeMillis() + QR_HOLD_MS
  }

  fun clearQrRecipient(context: Context) {
    qrHoldId = null
    if (activeRecipientFromQr(context)) clearActiveRecipient(context)
  }

  fun qrHoldRemainingMs(): Long = (qrHoldUntilMs - System.currentTimeMillis()).coerceAtLeast(0L)

  fun clearExpiredQrRecipient(context: Context): Boolean {
    if (!activeRecipientFromQr(context)) return false
    val id = activeRecipientAccountId(context)?.trim()?.uppercase()
    if (id != null && id == qrHoldId && System.currentTimeMillis() < qrHoldUntilMs) return false
    qrHoldId = null
    clearActiveRecipient(context)
    return true
  }

  /** Anciennes versions : destinataire BLE stocké sans marqueur → retiré une seule fois. */
  fun dropLegacyStickyRecipientOnce(context: Context) {
    val p = prefs(context)
    if (p.getBoolean(KEY_STICKY_MIGRATED, false)) return
    if (!activeRecipientFromQr(context)) p.edit().remove(KEY_RECIPIENT).apply()
    p.edit().putBoolean(KEY_STICKY_MIGRATED, true).apply()
    BlypShellPayDossierRam.invalidate()
  }

  fun isReady(context: Context): Boolean = read(context) != null

  fun readPinOnly(context: Context): String? {
    val pin = prefs(context).getString(KEY_PIN, "")?.replace(Regex("\\D"), "").orEmpty()
    return pin.ifEmpty { null }
  }

  /** Conserve destinataires / proches déjà sync. */
  fun syncTransactionPin(context: Context, pinDigits: String, balanceFcfa: Int) {
    val pin = pinDigits.replace(Regex("\\D"), "")
    if (pin.length != 4) return
    val p = prefs(context)
    val recipient = p.getString(KEY_RECIPIENT, "").orEmpty()
    val candidates = p.getString(KEY_CANDIDATES, "").orEmpty()
    sync(context, recipient, candidates, pin, balanceFcfa)
  }
}
