package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.haroldndougou.blyp.R
import org.json.JSONObject

/** Compte ouvert ailleurs — renvoie vers connexion (coque sans React). */
object BlypShellSessionReplaced {
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var kickInFlight = false

  fun isSessionReplacedResponse(httpCode: Int, body: String?): Boolean {
    if (httpCode != 401) return false
    val raw = body?.trim().orEmpty()
    if (raw.isEmpty()) return true
    return runCatching {
        val json = JSONObject(raw)
        when {
          json.optString("code", "") == "SESSION_REPLACED" -> true
          else -> {
            val err = json.optString("error", "").lowercase()
            err.contains("autre téléphone") ||
              err.contains("another device") ||
              err.contains("autre appareil")
          }
        }
      }
      .getOrDefault(true)
  }

  fun kickToSignIn(context: Context) {
    val app = context.applicationContext
    if (kickInFlight) return
    if (BlypShellSession.phone(app).isNullOrBlank()) return
    kickInFlight = true
    main.post {
      try {
        BlypShellAuthSignOut.perform(app)
        Toast.makeText(
            app,
            app.getString(R.string.blyp_shell_session_replaced_toast),
            Toast.LENGTH_LONG,
          )
          .show()
        ShellSignInActivity.startFresh(app)
      } finally {
        main.postDelayed({ kickInFlight = false }, 2000L)
      }
    }
  }

  fun maybeKickFromHttp(context: Context, httpCode: Int, body: String?) {
    if (isSessionReplacedResponse(httpCode, body)) {
      kickToSignIn(context)
    }
  }
}
