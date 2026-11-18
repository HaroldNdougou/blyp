package com.haroldndougou.blyp.shell

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

object BlypShellNetwork {
  fun isOnline(context: Context): Boolean {
    val cm =
      context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
        as? ConnectivityManager
        ?: return true
    val net = cm.activeNetwork ?: return false
    val caps = cm.getNetworkCapabilities(net) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
      caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }

  fun isRetryablePayFailure(message: String?): Boolean {
    val m = message?.trim().orEmpty()
    if (m.isEmpty() || m == "network") return true
    if (m.startsWith("http_")) {
      val code = m.removePrefix("http_").toIntOrNull() ?: return false
      /** 401 : session à renouveler (session morte = déconnexion, qui vide la file) — ne pas annuler un pay déjà annoncé. */
      return code == 401 || code == 408 || code == 429 || code >= 500
    }
    return false
  }
}
