package com.haroldndougou.blyp.shell

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Dossier pay local signé (HMAC) — détecte falsification des prefs chiffrées.
 * Solde et règles compte ; au clic payer on ne re-vérifie que le solde vs montant.
 */
object BlypShellPayDossierStore {
  private const val PREFS = "blyp_shell_pay_dossier_v1"
  private const val KEY_PAYLOAD = "payload_json"
  private const val KEY_MAC = "payload_mac"
  private const val KEY_HMAC_SECRET = "hmac_secret_b64"

  data class Verified(
    val phone: String,
    val recipientAccountId: String,
    val balanceFcfa: Int,
    val maxTxFcfa: Int,
    val payAllowed: Boolean,
    val payBlocked: Boolean,
    val updatedAtMs: Long,
  )

  private fun prefs(context: Context) = BlypSecurePrefs.get(context, PREFS)

  private fun hmacKey(context: Context): ByteArray {
    val p = prefs(context)
    val existing = p.getString(KEY_HMAC_SECRET, null)?.trim()
    if (!existing.isNullOrEmpty()) {
      return android.util.Base64.decode(existing, android.util.Base64.NO_WRAP)
    }
    val key = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
    p.edit()
      .putString(KEY_HMAC_SECRET, android.util.Base64.encodeToString(key, android.util.Base64.NO_WRAP))
      .apply()
    return key
  }

  private fun canonical(payload: JSONObject): String {
    return listOf(
      payload.optString("phone"),
      payload.optString("recipientAccountId"),
      payload.optInt("balanceFcfa", 0).toString(),
      payload.optInt("maxTxFcfa", 0).toString(),
      payload.optBoolean("payAllowed", false).toString(),
      payload.optBoolean("payBlocked", false).toString(),
      payload.optLong("updatedAtMs", 0L).toString(),
    ).joinToString("|")
  }

  private fun mac(context: Context, payload: JSONObject): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(hmacKey(context), "HmacSHA256"))
    val raw = mac.doFinal(canonical(payload).toByteArray(Charsets.UTF_8))
    return android.util.Base64.encodeToString(raw, android.util.Base64.NO_WRAP)
  }

  private fun verifyMac(context: Context, payload: JSONObject, expected: String): Boolean {
    val gotBytes = android.util.Base64.decode(mac(context, payload), android.util.Base64.NO_WRAP)
    val expBytes =
      runCatching {
        android.util.Base64.decode(expected.trim(), android.util.Base64.NO_WRAP)
      }.getOrNull() ?: return false
    return MessageDigest.isEqual(gotBytes, expBytes)
  }

  /** Recalcule et signe depuis session + pay runtime (après sync réseau / débit local). */
  fun refreshFromSources(context: Context) {
    val app = context.applicationContext
    val phone = BlypShellSession.phone(app)?.trim().orEmpty()
    val pay = BlypShellPayRuntime.read(app)
    val recipientId =
      pay?.let {
        runCatching { JSONObject(it.recipientJson).optString("accountId", "") }
          .getOrDefault("")
          .trim()
          .uppercase()
      }.orEmpty()
    val balance =
      if (pay != null) {
        BlypShellPayEligibility.effectiveBalanceFcfa(app, pay)
      } else {
        BlypShellSession.profile(app)?.balanceFcfa ?: 0
      }
    val maxTx = BlypShellPayEligibility.maxTxFcfa(app)
    val payBlocked = BlypShellSession.isPayBlocked(app)
    val payAllowed =
      phone.isNotEmpty() &&
        recipientId.isNotEmpty() &&
        pay != null &&
        BlypShellRuntime.read(app) != null &&
        !payBlocked &&
        !BlypShellSession.needsOnboarding(app) &&
        !BlypShellSession.isCommerceMode(app)
    val payload =
      JSONObject().apply {
        put("phone", phone)
        put("recipientAccountId", recipientId)
        put("balanceFcfa", balance.coerceAtLeast(0))
        put("maxTxFcfa", maxTx)
        put("payAllowed", payAllowed)
        put("payBlocked", payBlocked)
        put("updatedAtMs", System.currentTimeMillis())
      }
    val p = prefs(app)
    p.edit()
      .putString(KEY_PAYLOAD, payload.toString())
      .putString(KEY_MAC, mac(app, payload))
      .apply()
    BlypShellPayDossierRam.invalidate()
  }

  fun readVerified(context: Context): Verified? {
    val p = prefs(context.applicationContext)
    val raw = p.getString(KEY_PAYLOAD, null)?.trim().orEmpty()
    val sig = p.getString(KEY_MAC, null)?.trim().orEmpty()
    if (raw.isBlank() || sig.isBlank()) return null
    val payload =
      runCatching { JSONObject(raw) }.getOrNull() ?: return null
    if (!verifyMac(context.applicationContext, payload, sig)) return null
    val phone = payload.optString("phone", "").trim()
    val recipient = payload.optString("recipientAccountId", "").trim().uppercase()
    if (phone.isEmpty() || recipient.isEmpty()) return null
    return Verified(
      phone = phone,
      recipientAccountId = recipient,
      balanceFcfa = payload.optInt("balanceFcfa", 0).coerceAtLeast(0),
      maxTxFcfa = payload.optInt("maxTxFcfa", 0).coerceAtLeast(0),
      payAllowed = payload.optBoolean("payAllowed", false),
      payBlocked = payload.optBoolean("payBlocked", false),
      updatedAtMs = payload.optLong("updatedAtMs", 0L),
    )
  }

  /** Validation au moment PIN / empreinte — solde signé vs montant seulement. */
  fun isBalanceSufficientForPay(context: Context, amountFcfa: Int): Boolean {
    val amount = amountFcfa.coerceAtLeast(0)
    if (amount <= 0) return false
    var v = readVerified(context)
    if (v == null || !v.payAllowed) {
      refreshFromSources(context)
      v = readVerified(context)
    }
    if (v == null) return false
    return v.payAllowed && !v.payBlocked && amount <= v.balanceFcfa
  }

  fun clear(context: Context) {
    prefs(context.applicationContext).edit().clear().apply()
    BlypShellPayDossierRam.invalidate()
  }
}
