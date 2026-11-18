package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.haroldndougou.blyp.paymentannounce.PaymentAnnouncePrefs
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Renouvelle l’access (1 h) via le refresh (180 j) — calque `refreshSessionTokens` / `ensureSessionFresh`.
 * Seul rotateur du refresh sur Android : l’îlot RN passe par [refreshForJs] (rotation concurrente = famille révoquée).
 */
object BlypShellSessionRefresh {
  /** Large : renouvelé à l’ouverture bien avant l’échéance, jamais sur le clic Payer. */
  private const val RENEW_WITHIN_MS = 10 * 60 * 1000L
  private const val STILL_USABLE_MS = 60_000L
  private const val TIMEOUT_MS = 8_000
  private val lock = Any()
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  data class Tokens(val accessToken: String, val refreshToken: String?)

  private fun claims(token: String): JSONObject? =
    runCatching {
      val part = token.split(".").getOrNull(1) ?: return null
      JSONObject(
        String(Base64.decode(part, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)),
      )
    }.getOrNull()

  fun accessExpMs(token: String): Long? {
    val exp = claims(token)?.optLong("exp", 0L) ?: 0L
    return if (exp > 0L) exp * 1000L else null
  }

  /** Jeton lié à la clé appareil : le serveur l’accepte expiré (< 7 j) sur une action signée. */
  private fun isDeviceBound(token: String): Boolean =
    claims(token)?.optString("dpk", "")?.isNotBlank() == true

  /** Pay signé : jamais d’attente du renouvellement (fait en fond) ; ancien jeton non lié → attente. */
  fun accessForSignedPay(context: Context): String? {
    val snap = BlypShellRuntime.read(context) ?: return null
    if (!needsRenew(snap.accessToken)) return snap.accessToken
    if (isDeviceBound(snap.accessToken)) {
      ensureFreshAsync(context)
      return snap.accessToken
    }
    return freshAccessBlocking(context)
  }

  private fun needsRenew(token: String): Boolean {
    val exp = accessExpMs(token) ?: return false
    return exp - System.currentTimeMillis() <= RENEW_WITHIN_MS
  }

  /** Hors fil principal : access valide (renouvelé si besoin), sinon l’actuel. */
  fun freshAccessBlocking(context: Context): String? {
    val snap = BlypShellRuntime.read(context) ?: return null
    if (!needsRenew(snap.accessToken)) return snap.accessToken
    /** Encore valide : on part tout de suite avec, le renouvellement suit en fond. */
    val exp = accessExpMs(snap.accessToken) ?: 0L
    if (exp - System.currentTimeMillis() > STILL_USABLE_MS) {
      ensureFreshAsync(context)
      return snap.accessToken
    }
    return refreshBlocking(context, snap.accessToken)?.accessToken ?: snap.accessToken
  }

  fun ensureFreshAsync(context: Context) {
    val app = context.applicationContext
    io.execute {
      BlypShellDeviceKey.warm()
      runCatching {
        val snap = BlypShellRuntime.read(app) ?: return@runCatching
        if (needsRenew(snap.accessToken)) refreshBlocking(app, snap.accessToken)
      }
    }
  }

  /** Après un 401 : renouvelle même si l’access paraît encore valide. */
  fun refreshAfterUnauthorized(context: Context, rejectedAccess: String): String? =
    refreshBlocking(context, rejectedAccess)?.accessToken

  /** Appel îlot RN : adopte son refresh si la coque n’en a pas, puis renouvelle ici. */
  fun refreshForJs(context: Context, jsAccess: String?, jsRefresh: String?): Tokens? {
    val app = context.applicationContext
    val js = jsRefresh?.trim().orEmpty()
    if (js.isNotEmpty() && BlypShellRuntime.refreshToken(app) == null) {
      BlypShellRuntime.setRefreshToken(app, js)
    }
    val cur = BlypShellRuntime.read(app)
    if (cur != null && cur.accessToken != jsAccess?.trim() && !needsRenew(cur.accessToken)) {
      return Tokens(cur.accessToken, BlypShellRuntime.refreshToken(app))
    }
    return refreshBlocking(app, jsAccess?.trim()?.ifEmpty { null } ?: cur?.accessToken)
  }

  private fun refreshBlocking(context: Context, staleAccess: String?, retried: Boolean = false): Tokens? =
    synchronized(lock) {
      val app = context.applicationContext
      val cur = BlypShellRuntime.read(app)
      if (cur != null && cur.accessToken != staleAccess && !needsRenew(cur.accessToken)) {
        return Tokens(cur.accessToken, BlypShellRuntime.refreshToken(app))
      }
      val refresh = BlypShellRuntime.refreshToken(app) ?: return null
      val api = cur?.apiBaseUrl ?: BlypShellConfig.apiBaseUrl(app).trimEnd('/')
      if (api.isBlank()) return null
      val t0 = android.os.SystemClock.elapsedRealtime()
      val conn =
        try {
          (URL("$api/auth/refresh").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
          }
        } catch (_: Exception) {
          return null
        }
      try {
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
          val body = JSONObject().put("refreshToken", refresh)
          BlypShellDeviceKey.refreshProof(refresh)?.let { p -> body.put("deviceProof", p) }
          it.write(body.toString())
        }
        val code = conn.responseCode
        BlypShellDeviceKey.noteServerDate(conn)
        val body =
          (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() }
        BlypShellDeviceKey.perf("session_refresh", t0, " http=$code")
        if (code == 409 && BlypShellDeviceKey.handleSkewResponse(body)) {
          return if (retried) null else refreshBlocking(app, staleAccess, retried = true)
        }
        if (code in 200..299) {
          val json = JSONObject(body.orEmpty())
          val token = json.optString("token", "").trim()
          if (token.isEmpty()) return null
          val nextRefresh = json.optString("refreshToken", "").trim().ifEmpty { refresh }
          storeTokens(app, token, nextRefresh)
          return Tokens(token, nextRefresh)
        }
        if (code == 401 || code == 403) {
          /** Refresh refusé = session morte (calque `clearAuthSession`) ; réseau ≠ déconnexion. */
          if (BlypShellSessionReplaced.isSessionReplacedResponse(code, body)) {
            BlypShellSessionReplaced.kickToSignIn(app)
          } else {
            kickToSignIn(app)
          }
        }
        null
      } catch (_: Exception) {
        null
      } finally {
        conn.disconnect()
      }
    }

  private fun storeTokens(app: Context, access: String, refresh: String) {
    val api = BlypShellRuntime.read(app)?.apiBaseUrl ?: BlypShellConfig.apiBaseUrl(app)
    BlypShellRuntime.sync(app, api, access)
    BlypShellRuntime.setRefreshToken(app, refresh)
    BlypShellAuthMirror.updateAccessToken(app, access)
    runCatching { PaymentAnnouncePrefs.setApiSession(app, api, access) }
  }

  @Volatile private var kickInFlight = false

  private fun kickToSignIn(app: Context) {
    if (kickInFlight) return
    if (BlypShellSession.phone(app).isNullOrBlank()) return
    kickInFlight = true
    main.post {
      try {
        BlypShellAuthSignOut.perform(app)
        ShellSignInActivity.startFresh(app)
      } finally {
        main.postDelayed({ kickInFlight = false }, 2000L)
      }
    }
  }
}
