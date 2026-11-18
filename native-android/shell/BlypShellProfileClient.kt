package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object BlypShellProfileClient {
  fun updateFullName(context: Context, fullName: String): JSONObject? {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return null
    return try {
      val body = JSONObject().apply { put("fullName", fullName.trim()) }
      postJson(runtime, "${runtime.apiBaseUrl}/me/profile", "PUT", body)?.let { json ->
        json.optJSONObject("user")?.also { BlypShellUserParse.apply(context, it) }
        json
      }
    } catch (_: Exception) {
      null
    }
  }

  fun setSmallPayWithoutPin(context: Context, enabled: Boolean): Boolean {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return false
    return try {
      val body = JSONObject().apply { put("enabled", enabled) }
      postJson(runtime, "${runtime.apiBaseUrl}/me/small-pay-without-pin", "PUT", body)?.let { json ->
        json.optJSONObject("user")?.also { BlypShellUserParse.apply(context, it) }
        true
      } ?: false
    } catch (_: Exception) {
      false
    }
  }

  fun uploadAvatar(context: Context, imageFile: File, contentType: String): Boolean {
    val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: return false
    val ct = contentType.ifBlank { "image/jpeg" }
    return try {
      val presignBody = JSONObject().apply { put("contentType", ct) }
      val presign =
        postJson(runtime, "${runtime.apiBaseUrl}/me/avatar/presign", "POST", presignBody)
          ?: return false
      val uploadUrl = presign.optString("uploadUrl", "").trim()
      val key = presign.optString("key", "").trim()
      if (uploadUrl.isEmpty() || key.isEmpty()) return false
      if (!BlypShellUpload.putFile(uploadUrl, imageFile, ct)) return false
      val confirm =
        postJson(
          runtime,
          "${runtime.apiBaseUrl}/me/avatar/confirm",
          "POST",
          JSONObject().apply { put("key", key) },
        ) ?: return false
      confirm.optJSONObject("user")?.let { BlypShellUserParse.apply(context, it) }
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun postJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    method: String,
    body: JSONObject,
  ): JSONObject? {
    val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 25_000
      readTimeout = 35_000
      doOutput = method != "GET"
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
    }
    if (method != "GET") {
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write(body.toString())
      }
    }
    val code = conn.responseCode
    val text =
      (if (code in 200..299) conn.inputStream else conn.errorStream)
        ?.bufferedReader()
        ?.use(BufferedReader::readText)
        .orEmpty()
    conn.disconnect()
    if (code !in 200..299) return null
    return JSONObject(text.ifBlank { "{}" })
  }
}

object BlypShellUserParse {
  fun apply(context: Context, user: JSONObject) {
    val phone = user.optString("phone", "").trim()
    val first = user.optString("firstName", "").trim()
    val last = user.optString("lastName", "").trim()
    val displayName =
      listOf(first, last).filter { it.isNotEmpty() }.joinToString(" ").ifEmpty { "—" }
    val balance = user.optInt("balanceFcfa", -1)
    val avatar = user.optString("avatarUrl", "").trim().ifEmpty { null }
    val kyc = user.optString("kycStatus", "none").trim().ifEmpty { "none" }
    val accountId = user.optString("id", "").trim().ifEmpty { null }
    val onboarding = user.optBoolean("needsOnboarding", false)
    val commerce =
      user.optJSONObject("activeContext")?.optString("type", "") == "commerce"
    if (user.has("payBlocked")) {
      BlypShellSession.setPayBlocked(context, user.optBoolean("payBlocked", false))
    }
    BlypShellSession.sync(
      context.applicationContext,
      phone.ifEmpty { BlypShellSession.phone(context) },
      accountId ?: BlypShellSession.accountId(context),
      true,
      displayName,
      if (balance >= 0) balance else BlypShellSession.profile(context)?.balanceFcfa ?: 0,
      avatar,
      commerce,
      kyc,
      onboarding,
    )
    BlypShellCommerceSession.applyFromUser(context.applicationContext, user)
    if (user.has("smallPayWithoutPinEnabled")) {
      BlypShellSession.persistSmallPayWithoutPin(
        context,
        user.optBoolean("smallPayWithoutPinEnabled", false),
      )
    }
    BlypShellPayDossierStore.refreshFromSources(context.applicationContext)
    BlypShellUiRefresh.notifyWalletChanged()
  }
}
