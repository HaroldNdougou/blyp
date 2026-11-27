package com.haroldndougou.blyp.shell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

object BlypShellChatMediaSend {
  private val http =
    OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .writeTimeout(60, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .build()

  fun sendImageAsync(
    context: Context,
    conversationId: String,
    file: File,
    width: Int,
    height: Int,
    clientId: String,
    caption: String?,
    replyToMessageId: String?,
    onFinished: (ok: Boolean, message: JSONObject?) -> Unit,
  ) {
    Thread {
        var ok = false
        var msg: JSONObject? = null
        try {
          val app = context.applicationContext
          val runtime = BlypShellRuntime.readFresh(app) ?: throw IllegalStateException()
          val cid = conversationId.trim()
          val base =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
              "/messages"
          val presignBody = JSONObject().put("type", "image-presign").put("contentType", "image/jpeg")
          val presign = postJson(runtime, base, presignBody) ?: throw IllegalStateException()
          val uploadUrl = presign.optString("uploadUrl")
          val key = presign.optString("key")
          val thumbUrl = presign.optString("thumbUploadUrl")
          val thumbKey = presign.optString("thumbKey")
          if (uploadUrl.isBlank() || key.isBlank()) throw IllegalStateException()
          val jpeg = ensureJpeg(file, app)
          val imageType = presign.optString("contentType").trim().ifEmpty { "image/jpeg" }
          putFile(uploadUrl, jpeg, imageType)
          if (thumbUrl.isNotBlank() && thumbKey.isNotBlank()) {
            val thumb = thumbFile(jpeg, app)
            putFile(thumbUrl, thumb, "image/jpeg")
          }
          val sized = imageSize(file, width, height)
          val payload =
            JSONObject()
              .put("type", "image")
              .put("key", key)
              .put("width", sized.first)
              .put("height", sized.second)
              .put("clientId", clientId)
          val cap = caption?.trim().orEmpty()
          if (cap.isNotEmpty()) payload.put("caption", cap)
          replyToMessageId?.trim()?.takeIf { it.isNotEmpty() }?.let {
            payload.put("replyToMessageId", it)
          }
          if (thumbKey.isNotBlank()) payload.put("thumbKey", thumbKey)
          val res = postJson(runtime, base, payload) ?: throw IllegalStateException()
          msg = res.optJSONObject("message") ?: res
          ok = msg?.optString("id")?.isNotEmpty() == true
        } catch (_: Exception) {
          ok = false
        }
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          onFinished(ok, msg)
        }
      }
      .start()
  }

  private fun imageSize(file: File, width: Int, height: Int): Pair<Int, Int> {
    if (width > 0 && height > 0) return width to height
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    return bounds.outWidth.coerceAtLeast(1) to bounds.outHeight.coerceAtLeast(1)
  }

  fun sendVoiceAsync(
    context: Context,
    conversationId: String,
    file: File,
    durationMs: Int,
    clientId: String,
    replyToMessageId: String?,
    onFinished: (ok: Boolean, message: JSONObject?) -> Unit,
  ) {
    Thread {
        var ok = false
        var msg: JSONObject? = null
        try {
          val app = context.applicationContext
          val runtime = BlypShellRuntime.readFresh(app) ?: throw IllegalStateException()
          val cid = conversationId.trim()
          val base =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
              "/messages"
          val presign =
            postJson(runtime, base, JSONObject().put("type", "voice-presign"))
              ?: throw IllegalStateException()
          val uploadUrl = presign.optString("uploadUrl")
          val key = presign.optString("key")
          if (uploadUrl.isBlank() || key.isBlank()) throw IllegalStateException()
          val ct = presign.optString("contentType").trim().ifEmpty { "audio/mp4" }
          putFile(uploadUrl, file, ct)
          val payload =
            JSONObject()
              .put("type", "voice")
              .put("key", key)
              .put("durationMs", durationMs.coerceAtLeast(1))
              .put("clientId", clientId)
          replyToMessageId?.trim()?.takeIf { it.isNotEmpty() }?.let {
            payload.put("replyToMessageId", it)
          }
          val res = postJson(runtime, base, payload) ?: throw IllegalStateException()
          msg = res.optJSONObject("message") ?: res
          ok = msg?.optString("id")?.isNotEmpty() == true
        } catch (_: Exception) {
          ok = false
        }
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          onFinished(ok, msg)
        }
      }
      .start()
  }

  fun sendDocumentAsync(
    context: Context,
    conversationId: String,
    file: File,
    fileName: String,
    sizeBytes: Long,
    contentType: String,
    clientId: String,
    replyToMessageId: String?,
    onFinished: (ok: Boolean, message: JSONObject?) -> Unit,
  ) {
    Thread {
        var ok = false
        var msg: JSONObject? = null
        try {
          val app = context.applicationContext
          val runtime = BlypShellRuntime.readFresh(app) ?: throw IllegalStateException()
          val cid = conversationId.trim()
          val base =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
              "/messages"
          val presign =
            postJson(
              runtime,
              base,
              JSONObject()
                .put("type", "document-presign")
                .put("contentType", contentType)
                .put("fileName", fileName),
            ) ?: throw IllegalStateException()
          val uploadUrl = presign.optString("uploadUrl")
          val key = presign.optString("key")
          if (uploadUrl.isBlank() || key.isBlank()) throw IllegalStateException()
          val signedType = presign.optString("contentType").trim().ifEmpty { contentType }
          putFile(uploadUrl, file, signedType)
          val payload =
            JSONObject()
              .put("type", "document")
              .put("key", key)
              .put("fileName", fileName)
              .put("sizeBytes", sizeBytes.coerceAtLeast(file.length()))
              .put("contentType", contentType)
              .put("clientId", clientId)
          replyToMessageId?.trim()?.takeIf { it.isNotEmpty() }?.let {
            payload.put("replyToMessageId", it)
          }
          val res = postJson(runtime, base, payload) ?: throw IllegalStateException()
          msg = res.optJSONObject("message") ?: res
          ok = msg?.optString("id")?.isNotEmpty() == true
        } catch (_: Exception) {
          ok = false
        }
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          onFinished(ok, msg)
        }
      }
      .start()
  }

  fun sendMoneyAsync(
    context: Context,
    conversationId: String,
    amountFcfa: Int,
    clientId: String,
    idempotencyKey: String,
    transactionPin: String,
    caption: String?,
    replyToMessageId: String?,
    onFinished: (
      ok: Boolean,
      message: JSONObject?,
      balance: Int?,
      pinWrong: Boolean,
      retryable: Boolean,
    ) -> Unit,
  ) {
    Thread {
        var ok = false
        var msg: JSONObject? = null
        var balance: Int? = null
        var pinWrong = false
        var retryable = false
        try {
          val app = context.applicationContext
          val runtime = BlypShellRuntime.readFresh(app) ?: throw IllegalStateException()
          val cid = conversationId.trim()
          val url =
            "${runtime.apiBaseUrl.trimEnd('/')}/conversations/" +
              java.net.URLEncoder.encode(cid, Charsets.UTF_8.name()) +
              "/messages"
          val payload =
            JSONObject()
              .put("type", "money")
              .put("amount", amountFcfa)
              .put("clientId", clientId)
              .put("idempotencyKey", idempotencyKey)
              .put("transactionPin", transactionPin)
          caption?.trim()?.takeIf { it.isNotEmpty() }?.let { payload.put("caption", it) }
          replyToMessageId?.trim()?.takeIf { it.isNotEmpty() }?.let {
            payload.put("replyToMessageId", it)
          }
          val req =
            Request.Builder()
              .url(url)
              .header("Authorization", "Bearer ${runtime.accessToken}")
              .header("Accept", "application/json")
              .header("Idempotency-Key", idempotencyKey)
              .post(payload.toString().toRequestBody("application/json".toMediaType()))
              .build()
          http.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
              val err = runCatching { JSONObject(body) }.getOrNull()
              val code = err?.optString("code").orEmpty()
              val message = err?.optString("message").orEmpty()
              pinWrong =
                code == "TRANSACTION_PIN_INVALID" ||
                  message.contains("PIN", ignoreCase = true) ||
                  message.contains("code secret", ignoreCase = true)
              retryable = resp.code >= 500
              BlypShellSessionReplaced.maybeKickFromHttp(app, resp.code, body)
              throw IllegalStateException()
            }
            val root = JSONObject(body)
            msg = root.optJSONObject("message")
            balance = root.optInt("balanceFcfa", -1).takeIf { it >= 0 }
            ok = msg != null
          }
        } catch (_: java.io.IOException) {
          ok = false
          retryable = true
        } catch (_: Exception) {
          ok = false
        }
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          onFinished(ok, msg, balance, pinWrong, retryable)
        }
      }
      .start()
  }

  private fun postJson(
    runtime: BlypShellRuntime.Snapshot,
    url: String,
    body: JSONObject,
  ): JSONObject? {
    val req =
      Request.Builder()
        .url(url)
        .header("Authorization", "Bearer ${runtime.accessToken}")
        .header("Accept", "application/json")
        .post(body.toString().toRequestBody("application/json".toMediaType()))
        .build()
    http.newCall(req).execute().use { resp ->
      val text = resp.body?.string().orEmpty()
      if (!resp.isSuccessful) return null
      return JSONObject(text.ifBlank { "{}" })
    }
  }

  private fun putFile(url: String, file: File, contentType: String) {
    val req =
      Request.Builder()
        .url(url)
        .put(file.asRequestBody(contentType.toMediaType()))
        .header("Content-Type", contentType)
        .build()
    http.newCall(req).execute().use { resp ->
      if (!resp.isSuccessful) throw IllegalStateException("upload ${resp.code}")
    }
  }

  private fun ensureJpeg(src: File, context: Context): File {
    if (src.name.endsWith(".jpg", true) || src.name.endsWith(".jpeg", true)) return src
    val out = File(context.cacheDir, "chat-img-${System.currentTimeMillis()}.jpg")
    val bmp = BitmapFactory.decodeFile(src.absolutePath) ?: return src
    FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
    bmp.recycle()
    return out
  }

  private fun thumbFile(src: File, context: Context): File {
    val out = File(context.cacheDir, "chat-thumb-${System.currentTimeMillis()}.jpg")
    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.absolutePath, opts)
    val max = 480
    var sample = 1
    while (opts.outWidth / sample > max || opts.outHeight / sample > max) sample *= 2
    val decode = BitmapFactory.Options().apply { inSampleSize = sample }
    val bmp = BitmapFactory.decodeFile(src.absolutePath, decode) ?: return src
    FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 82, it) }
    bmp.recycle()
    return out
  }
}