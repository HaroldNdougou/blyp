package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object BlypShellAuthClient {
  private val io = Executors.newSingleThreadExecutor()

  data class VerifyPayload(
    val token: String?,
    val refreshToken: String?,
    val user: JSONObject?,
    val needsSessionReplaceConfirm: Boolean,
    val replacedPreviousSession: Boolean,
    val errorMessage: String?,
  )

  fun normalizePhoneDigits(raw: String): String? {
    var digits = raw.replace(Regex("\\D"), "")
    if (digits.length == 10 && digits.startsWith("0")) digits = digits.drop(1)
    if (digits.length == 12 && digits.startsWith("237")) digits = digits.takeLast(9)
    return if (digits.length == 9 && digits[0] == '6') digits else null
  }

  fun requestOtpAsync(context: Context, phoneDigits: String, onDone: (Boolean, String?) -> Unit) {
    io.execute {
      val (ok, err) = requestOtpSync(context, phoneDigits)
      onDone(ok, err)
    }
  }

  fun verifyOtpAsync(
    context: Context,
    phoneDigits: String,
    code: String,
    confirmReplaceSession: Boolean,
    onDone: (VerifyPayload) -> Unit,
  ) {
    io.execute {
      onDone(verifyOtpSync(context, phoneDigits, code, confirmReplaceSession))
    }
  }

  fun setOnboardingProfileAsync(
    context: Context,
    firstName: String,
    lastName: String,
    onDone: (JSONObject?, String?) -> Unit,
  ) {
    io.execute {
      val runtime = BlypShellRuntime.readFresh(context.applicationContext)
      if (runtime == null) {
        onDone(null, null)
        return@execute
      }
      val body =
        JSONObject().apply {
          put("firstName", firstName.trim())
          put("lastName", lastName.trim())
        }
      val (ok, json) =
        postJson(
          runtime,
          "${runtime.apiBaseUrl}/auth/onboarding/profile",
          "POST",
          body,
          authorized = true,
        )
      if (!ok || json == null) {
        onDone(null, null)
        return@execute
      }
      val user = json.optJSONObject("user")
      if (user != null) BlypShellUserParse.apply(context.applicationContext, user)
      onDone(user, null)
    }
  }

  fun setOnboardingPinAsync(
    context: Context,
    pin: String,
    onDone: (JSONObject?, String?) -> Unit,
  ) {
    io.execute {
      val runtime = BlypShellRuntime.readFresh(context.applicationContext)
      if (runtime == null) {
        onDone(null, null)
        return@execute
      }
      val body = JSONObject().apply { put("pin", pin) }
      val (ok, json) =
        postJson(
          runtime,
          "${runtime.apiBaseUrl}/auth/onboarding/transaction-pin",
          "POST",
          body,
          authorized = true,
        )
      if (!ok || json == null) {
        onDone(null, null)
        return@execute
      }
      val user = json.optJSONObject("user")
      if (user != null) {
        BlypShellAuthComplete.applyVerifiedSession(
          context.applicationContext,
          runtime.accessToken,
          null,
          user,
        )
        BlypShellPayBootstrap.applyLocalPin(context.applicationContext, pin)
      }
      onDone(user, null)
    }
  }

  sealed class PinCheck {
    object Valid : PinCheck()
    data class Wrong(val remaining: Int) : PinCheck()
    data class Locked(val retryAfterSec: Int) : PinCheck()
    object Failed : PinCheck()
  }

  /** Compte existant : le serveur valide le code secret avant stockage local. */
  fun verifyTransactionPinAsync(context: Context, pin: String, onDone: (PinCheck) -> Unit) {
    io.execute {
      val app = context.applicationContext
      val result =
        try {
          val runtime = BlypShellRuntime.readFresh(app)
          if (runtime == null) {
            PinCheck.Failed
          } else {
            val (ok, json) =
              postJson(
                runtime,
                "${runtime.apiBaseUrl}/me/transaction-pin/verify",
                "POST",
                JSONObject().apply { put("pin", pin) },
                authorized = true,
              )
            when {
              ok -> {
                BlypShellPayBootstrap.applyLocalPin(app, pin)
                PinCheck.Valid
              }
              json?.optString("code") == "PIN_WRONG" -> {
                val left = json.optInt("remaining", 0)
                if (left > 0) PinCheck.Wrong(left) else PinCheck.Locked(15 * 60)
              }
              json?.optString("code") == "PIN_LOCKED" ->
                PinCheck.Locked(json.optInt("retryAfterSeconds", 0))
              else -> PinCheck.Failed
            }
          }
        } catch (_: Exception) {
          PinCheck.Failed
        }
      onDone(result)
    }
  }

  fun changeTransactionPinAsync(
    context: Context,
    currentPin: String,
    newPin: String,
    onDone: (PinCheck) -> Unit,
  ) {
    io.execute {
      val app = context.applicationContext
      val result =
        try {
          val runtime = BlypShellRuntime.readFresh(app)
          if (runtime == null) {
            PinCheck.Failed
          } else {
            val (ok, json) =
              postJson(
                runtime,
                "${runtime.apiBaseUrl}/me/transaction-pin/change",
                "POST",
                JSONObject().apply {
                  put("currentPin", currentPin)
                  put("pin", newPin)
                },
                authorized = true,
              )
            when {
              ok -> {
                BlypShellPayBootstrap.applyLocalPin(app, newPin)
                PinCheck.Valid
              }
              json?.optString("code") == "PIN_WRONG" -> {
                val left = json.optInt("remaining", 0)
                if (left > 0) PinCheck.Wrong(left) else PinCheck.Locked(15 * 60)
              }
              json?.optString("code") == "PIN_LOCKED" ->
                PinCheck.Locked(json.optInt("retryAfterSeconds", 0))
              else -> PinCheck.Failed
            }
          }
        } catch (_: Exception) {
          PinCheck.Failed
        }
      onDone(result)
    }
  }

  private fun requestOtpSync(context: Context, phoneDigits: String): Pair<Boolean, String?> {
    val api = BlypShellConfig.apiBaseUrl(context.applicationContext)
    if (api.isEmpty()) return false to null
    val body = JSONObject().apply { put("phone", phoneDigits) }
    val (ok, json) =
      postJson(
        null,
        "$api/auth/request-otp",
        "POST",
        body,
        authorized = false,
      )
    return ok to extractError(json)
  }

  private fun verifyOtpSync(
    context: Context,
    phoneDigits: String,
    code: String,
    confirmReplaceSession: Boolean,
  ): VerifyPayload {
    val api = BlypShellConfig.apiBaseUrl(context.applicationContext)
    if (api.isEmpty()) {
      return VerifyPayload(null, null, null, false, false, null)
    }
    val body =
      JSONObject().apply {
        put("phone", phoneDigits)
        put("code", code.trim())
        put("deviceId", BlypShellInstallDevice.getOrCreate(context.applicationContext))
        if (confirmReplaceSession) put("confirmReplaceSession", true)
        BlypShellDeviceKey.publicKey()?.let { put("devicePublicKey", it) }
      }
    val (ok, json) =
      postJson(
        null,
        "$api/auth/verify-otp",
        "POST",
        body,
        authorized = false,
      )
    if (!ok || json == null) {
      return VerifyPayload(null, null, null, false, false, extractError(json))
    }
    val needsReplace = json.optBoolean("needsSessionReplaceConfirm", false)
    val replaced = json.optBoolean("replacedPreviousSession", false)
    val token = json.optString("token", "").trim().ifEmpty { null }
    val refresh = json.optString("refreshToken", "").trim().ifEmpty { null }
    val user = json.optJSONObject("user")
    if (token != null && user != null && !needsReplace) {
      BlypShellAuthComplete.applyVerifiedSession(context.applicationContext, token, refresh, user)
    }
    return VerifyPayload(
      token,
      refresh,
      user,
      needsReplace,
      replaced,
      extractError(json),
    )
  }

  private fun extractError(json: JSONObject?): String? {
    if (json == null) return null
    val msg = json.optString("message", "").trim()
    if (msg.isNotEmpty()) return msg
    val err = json.optString("error", "").trim()
    return err.ifEmpty { null }
  }

  private fun postJson(
    runtime: BlypShellRuntime.Snapshot?,
    urlStr: String,
    method: String,
    body: JSONObject,
    authorized: Boolean,
  ): Pair<Boolean, JSONObject?> {
    val conn =
      (URL(urlStr).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 25_000
        readTimeout = 35_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        if (authorized && runtime != null) {
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        }
      }
    val bodyText = body.toString()
    if (authorized && runtime != null) {
      BlypShellDeviceKey.applyProof(conn, runtime.apiBaseUrl, method, bodyText)
    }
    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
      w.write(bodyText)
    }
    val code = conn.responseCode
    BlypShellDeviceKey.noteServerDate(conn)
    val text =
      (if (code in 200..299) conn.inputStream else conn.errorStream)
        ?.bufferedReader()
        ?.use(BufferedReader::readText)
        .orEmpty()
    conn.disconnect()
    val json =
      try {
        JSONObject(text.ifBlank { "{}" })
      } catch (_: Exception) {
        null
      }
    return (code in 200..299) to json
  }
}
