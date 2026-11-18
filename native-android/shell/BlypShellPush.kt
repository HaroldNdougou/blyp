package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.haroldndougou.blyp.BuildConfig
import expo.modules.notifications.serverregistration.InstallationId
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Autorisation notifs + jeton Expo → `PUT /me/device-token` (miroir `lib/push/register.ts`). */
object BlypShellPush {
  private const val TAG = "BlypShellPush"
  private const val PREFS = "blyp_shell_push_v1"
  private const val KEY_DEVICE_ID = "device_id"
  private const val KEY_TOKEN = "expo_token"
  private const val KEY_ACCOUNT = "account_id"
  private const val KEY_FCM = "fcm_token"
  private const val KEY_CHECK_AT = "checked_at"
  private const val CHECK_EVERY_MS = 7L * 24 * 60 * 60 * 1000
  private const val EXPO_TOKEN_URL = "https://exp.host/--/api/v2/push/getExpoPushToken"
  private const val EAS_PROJECT_ID = "5a25b2ac-490a-4328-bc6a-5daf01f1bcf0"

  private val JSON = "application/json".toMediaType()
  private val client =
    OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .build()
  private val io = Executors.newSingleThreadExecutor()
  @Volatile private var askedThisProcess = false

  private fun prefs(context: Context) = BlypSecurePrefs.get(context, PREFS)

  fun needsPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED

  /** Après le 1er frame de la coque : popup système si besoin, puis enregistrement. */
  fun onShellReady(context: Context, permissionLauncher: ActivityResultLauncher<String>) {
    if (needsPermission(context)) {
      if (askedThisProcess) return
      askedThisProcess = true
      permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      return
    }
    registerAsync(context)
  }

  fun onPermissionResult(context: Context, granted: Boolean) {
    if (granted) registerAsync(context)
  }

  fun registerAsync(context: Context) {
    val app = context.applicationContext
    io.execute {
      try {
        register(app)
      } catch (e: Exception) {
        if (BuildConfig.DEBUG) Log.w(TAG, "register failed", e)
      }
    }
  }

  private fun register(app: Context) {
    if (!NotificationManagerCompat.from(app).areNotificationsEnabled()) return
    val runtime = BlypShellRuntime.readFresh(app) ?: return
    val account = BlypShellSession.accountId(app)?.trim().orEmpty()
    val p = prefs(app)
    val fcm = Tasks.await(FirebaseMessaging.getInstance().token, 20, TimeUnit.SECONDS)
    if (fcm.isNullOrBlank()) return
    val alreadyRegistered =
      p.getString(KEY_ACCOUNT, "") == account &&
        p.getString(KEY_FCM, "") == fcm &&
        !p.getString(KEY_TOKEN, "").isNullOrBlank()
    if (alreadyRegistered) return

    val expoToken = fetchExpoToken(app, fcm) ?: return
    val deviceId = deviceId(app)
    val body =
      JSONObject().apply {
        put("token", expoToken)
        put("platform", "android")
        put("deviceId", deviceId)
      }
    val ok = send("PUT", "${runtime.apiBaseUrl}/me/device-token", body, runtime.accessToken)
    if (!ok) return
    p.edit()
      .putString(KEY_TOKEN, expoToken)
      .putString(KEY_ACCOUNT, account)
      .putString(KEY_FCM, fcm)
      .putLong(KEY_CHECK_AT, System.currentTimeMillis())
      .apply()
    if (BuildConfig.DEBUG) Log.d(TAG, "token enregistré deviceId=$deviceId")
  }

  /** Rotation FCM (Google) : l’ancienne adresse Expo deviendrait invalide → réinscription immédiate. */
  fun onNewFcmToken(context: Context) {
    registerAsync(context)
  }

  /**
   * Filet hebdo à l’ouverture du WS : le serveur répond `push_register_needed` seulement si
   * l’adresse a été perdue. La perte en direct est déjà signalée par le serveur (WS).
   */
  fun pushCheckFrame(context: Context): String? {
    val p = prefs(context.applicationContext)
    if (p.getString(KEY_TOKEN, "").isNullOrBlank()) return null
    val deviceId = p.getString(KEY_DEVICE_ID, "").orEmpty().ifEmpty { return null }
    val now = System.currentTimeMillis()
    if (now - p.getLong(KEY_CHECK_AT, 0L) < CHECK_EVERY_MS) return null
    p.edit().putLong(KEY_CHECK_AT, now).apply()
    return JSONObject().put("action", "push_check").put("deviceId", deviceId).toString()
  }

  fun onRegisterNeeded(context: Context) {
    val app = context.applicationContext
    prefs(app).edit().remove(KEY_TOKEN).apply()
    registerAsync(app)
  }

  /** À appeler avant d’effacer la session (jeton d’accès encore lisible). */
  fun unregisterAsync(context: Context) {
    val app = context.applicationContext
    val runtime = BlypShellRuntime.readFresh(app)
    val p = prefs(app)
    val token = p.getString(KEY_TOKEN, "").orEmpty()
    val deviceId = p.getString(KEY_DEVICE_ID, "").orEmpty()
    p.edit().remove(KEY_TOKEN).remove(KEY_ACCOUNT).remove(KEY_FCM).apply()
    if (runtime == null || deviceId.isEmpty()) return
    io.execute {
      val body =
        JSONObject().apply {
          if (token.isNotEmpty()) put("token", token)
          put("deviceId", deviceId)
        }
      send("DELETE", "${runtime.apiBaseUrl}/me/device-token", body, runtime.accessToken)
    }
  }

  private fun deviceId(app: Context): String {
    val p = prefs(app)
    p.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }?.let { return it }
    val rand = (1..8).map { "abcdefghijklmnopqrstuvwxyz0123456789".random() }.joinToString("")
    val id = "d_${System.currentTimeMillis().toString(36)}_$rand"
    p.edit().putString(KEY_DEVICE_ID, id).apply()
    return id
  }

  private fun fetchExpoToken(app: Context, fcm: String): String? {
    val body =
      JSONObject().apply {
        put("type", "fcm")
        put("deviceId", InstallationId(app).getOrCreateUUID().lowercase())
        put("development", false)
        put("appId", app.packageName)
        put("deviceToken", fcm)
        put("projectId", EAS_PROJECT_ID)
      }
    val json = sendForJson("POST", EXPO_TOKEN_URL, body, null) ?: return null
    return json.optJSONObject("data")?.optString("expoPushToken", "")?.trim()?.ifEmpty { null }
  }

  private fun send(method: String, url: String, body: JSONObject, bearer: String?): Boolean =
    sendForJson(method, url, body, bearer) != null

  private fun sendForJson(
    method: String,
    urlStr: String,
    body: JSONObject,
    bearer: String?,
  ): JSONObject? {
    return try {
      val req =
        Request.Builder()
          .url(urlStr)
          .method(method, body.toString().toRequestBody(JSON))
          .apply { if (bearer != null) header("Authorization", "Bearer $bearer") }
          .build()
      val (code, text) = client.newCall(req).execute().use { it.code to it.body?.string().orEmpty() }
      if (code !in 200..299) {
        if (BuildConfig.DEBUG) Log.w(TAG, "$method $urlStr → $code")
        return null
      }
      try {
        JSONObject(text.ifBlank { "{}" })
      } catch (_: Exception) {
        JSONObject()
      }
    } catch (e: Exception) {
      if (BuildConfig.DEBUG) Log.w(TAG, "$method $urlStr failed", e)
      null
    }
  }
}
