package com.haroldndougou.blyp.shell

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.haroldndougou.blyp.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Clé appareil (modèle WhatsApp) : EC P-256 générée dans la zone sécurisée du téléphone (TEE),
 * jamais exportable. Signe le renouvellement de session et les actions d’argent — un jeton volé
 * ne sert à rien hors de ce téléphone. Format aligné `aws/lib/deviceKey.mjs`.
 */
object BlypShellDeviceKey {
  private const val ALIAS = "blyp_device_key_v1"
  private const val PROVIDER = "AndroidKeyStore"
  private val lock = Any()
  @Volatile private var privateKey: PrivateKey? = null
  @Volatile private var publicKeyB64: String? = null
  /** Écart heure serveur − heure téléphone : preuves datées à l’heure serveur (fenêtre ±2 min). */
  @Volatile private var serverOffsetMs = 0L
  const val CLOCK_SKEW_CODE = "DEVICE_CLOCK_SKEW"

  private fun now(): Long = System.currentTimeMillis() + serverOffsetMs

  fun noteServerTime(serverMs: Long) {
    if (serverMs <= 0L) return
    val delta = serverMs - System.currentTimeMillis()
    if (kotlin.math.abs(delta - serverOffsetMs) > 5_000L) serverOffsetMs = delta
  }

  /** En-tête HTTP `Date` (à la seconde) de toute réponse serveur. */
  fun noteServerDate(conn: HttpURLConnection) {
    runCatching { noteServerTime(conn.getHeaderFieldDate("Date", 0L)) }
  }

  /** Réponse « horloge décalée » : recale et indique qu’on peut renvoyer une fois. */
  fun handleSkewResponse(body: String?): Boolean {
    val json = runCatching { JSONObject(body.orEmpty()) }.getOrNull() ?: return false
    if (json.optString("code", "") != CLOCK_SKEW_CODE) return false
    noteServerTime(json.optLong("serverTime", 0L))
    return true
  }

  /** Hors fil principal (génération ~100 ms la 1re fois) ; ensuite RAM. */
  fun warm() {
    runCatching { ensure() }
  }

  fun publicKey(): String? = runCatching { ensure(); publicKeyB64 }.getOrNull()

  private fun ensure() {
    if (privateKey != null && publicKeyB64 != null) return
    synchronized(lock) {
      if (privateKey != null && publicKeyB64 != null) return
      val t0 = SystemClock.elapsedRealtime()
      val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
      val created = !ks.containsAlias(ALIAS)
      if (created) generate()
      val entry = ks.getEntry(ALIAS, null) as KeyStore.PrivateKeyEntry
      privateKey = entry.privateKey
      publicKeyB64 = Base64.encodeToString(entry.certificate.publicKey.encoded, Base64.NO_WRAP)
      perf(if (created) "device_key_generate" else "device_key_load", t0)
    }
  }

  /** TEE (pas StrongBox : signature 10× plus lente, inacceptable sur le chemin Payer). */
  private fun generate() {
    val spec =
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build()
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).apply {
      initialize(spec)
      generateKeyPair()
    }
  }

  private fun sign(message: String): String? =
    runCatching {
      ensure()
      val t0 = SystemClock.elapsedRealtime()
      val s = Signature.getInstance("SHA256withECDSA")
      s.initSign(privateKey)
      s.update(message.toByteArray(Charsets.UTF_8))
      Base64.encodeToString(s.sign(), Base64.NO_WRAP).also { perf("device_sign", t0) }
    }.getOrNull()

  internal fun perf(name: String, t0: Long, extra: String = "") {
    if (BuildConfig.DEBUG) {
      Log.d("BlypPerf", "$name: ${SystemClock.elapsedRealtime() - t0}ms$extra")
    }
  }

  private fun sha256Hex(raw: String): String =
    MessageDigest.getInstance("SHA-256")
      .digest(raw.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }

  /** Corps `deviceProof` pour /auth/refresh. */
  fun refreshProof(refreshToken: String): JSONObject? {
    val ts = now()
    val sig = sign("blyp-refresh\n$ts\n${sha256Hex(refreshToken)}") ?: return null
    val pub = publicKeyB64 ?: return null
    return JSONObject().put("ts", ts).put("sig", sig).put("publicKey", pub)
  }

  /** En-têtes de preuve pour une action d’argent ; `path` relatif à l’API (ex. `/payments/pay`). */
  fun requestProof(method: String, path: String, body: String): Pair<String, String>? {
    val ts = now().toString()
    val msg = "blyp-req\n${method.uppercase()}\n$path\n$ts\n${sha256Hex(body)}"
    val sig = sign(msg) ?: return null
    return ts to sig
  }

  /** À appeler avant d’écrire le corps. */
  fun applyProof(conn: HttpURLConnection, apiBase: String, method: String, body: String) {
    val full = conn.url.toString()
    val path = full.removePrefix(apiBase.trimEnd('/')).substringBefore('?')
    val proof = requestProof(method, path, body) ?: return
    conn.setRequestProperty("X-Blyp-Ts", proof.first)
    conn.setRequestProperty("X-Blyp-Sig", proof.second)
  }
}
