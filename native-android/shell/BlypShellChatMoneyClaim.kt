package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object BlypShellChatMoneyClaim {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(45, TimeUnit.SECONDS)
      .build()
  private val main = Handler(Looper.getMainLooper())

  fun claimAsync(
    context: Context,
    transferId: String,
    action: String,
    onFinished: (ok: Boolean, transfer: JSONObject?, balance: Int?) -> Unit,
  ) {
    Thread {
        var ok = false
        var transfer: JSONObject? = null
        var balance: Int? = null
        try {
          val runtime = BlypShellRuntime.readFresh(context.applicationContext) ?: throw IllegalStateException()
          val tid = transferId.trim()
          val url =
            "${runtime.apiBaseUrl.trimEnd('/')}/money-transfers/" +
              java.net.URLEncoder.encode(tid, Charsets.UTF_8.name()) +
              "/claim"
          val req =
            Request.Builder()
              .url(url)
              .header("Authorization", "Bearer ${runtime.accessToken}")
              .header("Accept", "application/json")
              .post(
                JSONObject().put("action", action).toString().toRequestBody(
                  "application/json".toMediaType(),
                ),
              )
              .build()
          http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
              BlypShellSessionReplaced.maybeKickFromHttp(context, resp.code, text)
              throw IllegalStateException()
            }
            val root = JSONObject(text)
            transfer = root.optJSONObject("transfer")
            balance = root.optInt("balanceFcfa", -1).takeIf { it >= 0 }
            ok = transfer != null
          }
        } catch (_: Exception) {
          ok = false
        }
        main.post { onFinished(ok, transfer, balance) }
      }
      .start()
  }
}