package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject

object BlypShellAuthComplete {
  /** Mise à jour profil / contexte sans ré-enfiler l’auth JS. */
  fun applyUserUpdate(context: Context, accessToken: String, user: JSONObject) {
    val app = context.applicationContext
    val wasCommerce = BlypShellSession.isCommerceMode(app)
    BlypShellUserParse.apply(app, user)
    BlypShellCommerceSession.applyFromUser(app, user)
    val api = BlypShellConfig.apiBaseUrl(app)
    val cdn = BlypShellConfig.assetsCdnUrl(app)
    val ws = BlypShellConfig.realtimeWsUrl(app)
    val phone = user.optString("phone", "").trim()
    val first = user.optString("firstName", "").trim()
    val last = user.optString("lastName", "").trim()
    val displayName =
      listOf(first, last).filter { it.isNotEmpty() }.joinToString(" ").ifEmpty { "—" }
    val balance = user.optInt("balanceFcfa", 0).coerceAtLeast(0)
    val avatar = user.optString("avatarUrl", "").trim().ifEmpty { null }
    val kyc = user.optString("kycStatus", "none").trim().ifEmpty { "none" }
    val accountId = user.optString("id", "").trim().ifEmpty { null }
    val onboarding = user.optBoolean("needsOnboarding", false)
    val commerce =
      user.optJSONObject("activeContext")?.optString("type", "") == "commerce"
    BlypShellAuthMirror.persist(
      app,
      phone,
      accountId,
      true,
      displayName,
      balance,
      avatar,
      api.ifEmpty { null },
      accessToken.trim(),
      cdn.ifEmpty { null },
      ws.ifEmpty { null },
      commerce,
      kyc,
      onboarding,
    )
    if (wasCommerce && !commerce) {
      BlypShellTaxiBroadcast.stopImmediately(app)
    }
    BlypShellPayRuntime.updateBalance(app, balance)
    BlypShellUiRefresh.notifyWalletChanged()
  }

  fun applyVerifiedSession(
    context: Context,
    accessToken: String,
    refreshToken: String?,
    user: JSONObject,
  ) {
    val app = context.applicationContext
    val api = BlypShellConfig.apiBaseUrl(app)
    val cdn = BlypShellConfig.assetsCdnUrl(app)
    val ws = BlypShellConfig.realtimeWsUrl(app)
    BlypShellUserParse.apply(app, user)
    BlypShellCommerceSession.applyFromUser(app, user)
    if (api.isNotEmpty()) {
      BlypShellRuntime.sync(app, api, accessToken.trim(), cdn.ifEmpty { null })
    }
    if (!refreshToken.isNullOrBlank()) BlypShellRuntime.setRefreshToken(app, refreshToken)
    val phone = user.optString("phone", "").trim()
    val first = user.optString("firstName", "").trim()
    val last = user.optString("lastName", "").trim()
    val displayName =
      listOf(first, last).filter { it.isNotEmpty() }.joinToString(" ").ifEmpty { "—" }
    val balance = user.optInt("balanceFcfa", 0).coerceAtLeast(0)
    val avatar = user.optString("avatarUrl", "").trim().ifEmpty { null }
    val kyc = user.optString("kycStatus", "none").trim().ifEmpty { "none" }
    val accountId = user.optString("id", "").trim().ifEmpty { null }
    val onboarding = user.optBoolean("needsOnboarding", false)
    val commerce =
      user.optJSONObject("activeContext")?.optString("type", "") == "commerce"
    BlypShellAuthMirror.persist(
      app,
      phone,
      accountId,
      true,
      displayName,
      balance,
      avatar,
      api.ifEmpty { null },
      accessToken.trim(),
      cdn.ifEmpty { null },
      ws.ifEmpty { null },
      commerce,
      kyc,
      onboarding,
    )
    BlypShellPayRuntime.updateBalance(app, balance)
    BlypShellJsAuthPending.enqueue(app, accessToken, refreshToken, user.toString())
    BlypShellUiRefresh.notifyWalletChanged()
  }
}
