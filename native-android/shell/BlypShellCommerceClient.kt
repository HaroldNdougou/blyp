package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object BlypShellCommerceClient {
  private val io = Executors.newSingleThreadExecutor()

  fun refreshMeAsync(context: Context, onDone: (Boolean) -> Unit) {
    io.execute {
      onDone(refreshMeSync(context.applicationContext))
    }
  }

  /** Après paiement confirmé serveur — solde, plafond, mode compte → dossier signé local. */
  fun refreshDossierAfterPaymentAsync(context: Context) {
    io.execute {
      val app = context.applicationContext
      refreshMeSync(app)
      BlypShellPayDossierStore.refreshFromSources(app)
      BlypShellPayDossierRam.invalidate()
    }
  }

  fun setActiveContextAsync(
    context: Context,
    personal: Boolean,
    commerceId: String?,
    onDone: (SwitchOutcome) -> Unit,
  ) {
    io.execute {
      onDone(setActiveContextSync(context.applicationContext, personal, commerceId))
    }
  }

  fun createCommerceAsync(
    context: Context,
    name: String,
    category: String,
    categoryLabel: String = "",
    onDone: (CreateResult) -> Unit,
  ) {
    io.execute {
      onDone(createCommerceSync(context.applicationContext, name, category, categoryLabel))
    }
  }

  data class CreateResult(
    val ok: Boolean,
    val message: String? = null,
  )

  private fun createCommerceSync(
    context: Context,
    name: String,
    category: String,
    categoryLabel: String = "",
  ): CreateResult {
    val runtime = BlypShellRuntime.readFresh(context) ?: return CreateResult(false, null)
    val trimmed = name.trim().replace(Regex("\\s+"), " ")
    if (trimmed.length < 2) {
      return CreateResult(false, "NAME_TOO_SHORT")
    }
    val cat =
      when (category.trim().lowercase()) {
        "taxi", "shop", "street", "other", "soa_car" -> category.trim().lowercase()
        else -> "other"
      }
    val note = categoryLabel.trim().replace(Regex("\\s+"), " ")
    val body =
      JSONObject().apply {
        put("name", trimmed)
        put("category", cat)
        if (cat == "other" && note.length >= 2) put("categoryLabel", note)
      }
    val (ok, json) =
      postJson(runtime, "${runtime.apiBaseUrl}/commerces", body) ?: return CreateResult(false, null)
    if (!ok || json == null) {
      val msg =
        json?.optString("message")?.trim()?.ifEmpty { null }
          ?: json?.optString("error")?.trim()?.ifEmpty { null }
      return CreateResult(false, msg)
    }
    val user = json.optJSONObject("user") ?: return CreateResult(false, null)
    BlypShellAuthComplete.applyUserUpdate(context, runtime.accessToken, user)
    if (cat == "other" && note.length >= 2) {
      BlypShellCommerceSession.attachCategoryLabel(context, trimmed, note)
    }
    if (cat == "street") BlypShellCommerceSession.rememberCategory(context, trimmed, cat)
    val wasOnline = BlypShellTaxiBroadcast.snapshot(context).wantOn
    if (wasOnline) {
      BlypShellTaxiBroadcast.setWantOn(context, true)
    }
    BlypShellUiRefresh.notifyWalletChanged()
    return CreateResult(true, null)
  }

  fun updateCommerceCategoryAsync(
    context: Context,
    commerceId: String,
    category: String,
    onDone: (Boolean) -> Unit,
  ) {
    io.execute {
      onDone(updateCategorySync(context.applicationContext, commerceId, category))
    }
  }

  private fun updateCategorySync(
    context: Context,
    commerceId: String,
    category: String,
  ): Boolean {
    val runtime = BlypShellRuntime.readFresh(context) ?: return false
    val id = commerceId.trim()
    if (id.isEmpty()) return false
    val cat =
      when (category.trim().lowercase()) {
        "taxi", "shop", "street", "other", "soa_car" -> category.trim().lowercase()
        else -> return false
      }
    val body = JSONObject().put("category", cat)
    val (ok, json) =
      patchJson(runtime, "${runtime.apiBaseUrl}/commerces/$id", body) ?: return false
    if (!ok || json == null) return false
    val user = json.optJSONObject("user") ?: return false
    BlypShellAuthComplete.applyUserUpdate(context, runtime.accessToken, user)
    BlypShellCommerceSession.clearCategoryOverride(context, id)
    val wasOnline = BlypShellTaxiBroadcast.snapshot(context).wantOn
    if (wasOnline) {
      BlypShellTaxiBroadcast.setWantOn(context, true)
    }
    return true
  }

  private fun refreshMeSync(context: Context): Boolean {
    val runtime = BlypShellRuntime.readFresh(context) ?: return false
    val (ok, json) =
      getJson(runtime, "${runtime.apiBaseUrl}/me") ?: return false
    if (!ok || json == null) return false
    val user = json.optJSONObject("user") ?: if (json.has("phone")) json else return false
    BlypShellAuthComplete.applyUserUpdate(context, runtime.accessToken, user)
    return true
  }

  enum class SwitchOutcome {
    Ok,
    Offline,
    Network,
    Failed,
  }

  private fun setActiveContextSync(
    context: Context,
    personal: Boolean,
    commerceId: String?,
  ): SwitchOutcome {
    if (!BlypShellNetwork.isOnline(context)) return SwitchOutcome.Offline
    val runtime = BlypShellRuntime.readFresh(context) ?: return SwitchOutcome.Failed
    val body =
      JSONObject().apply {
        if (personal) {
          put("type", "personal")
        } else {
          put("type", "commerce")
          put("commerceId", commerceId?.trim().orEmpty())
        }
      }
    val (ok, json) =
      putJson(runtime, "${runtime.apiBaseUrl}/me/context", body) ?: return SwitchOutcome.Network
    if (!ok || json == null) return SwitchOutcome.Failed
    val user = json.optJSONObject("user") ?: return SwitchOutcome.Failed
    BlypShellAuthComplete.applyUserUpdate(context, runtime.accessToken, user)
    return SwitchOutcome.Ok
  }

  private fun getJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
  ): Pair<Boolean, JSONObject?>? {
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          connectTimeout = 25_000
          readTimeout = 35_000
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
          setRequestProperty("Accept", "application/json")
        }
      val code = conn.responseCode
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
      (code in 200..299) to json
    } catch (_: Exception) {
      null
    }
  }

  private fun putJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    body: JSONObject,
  ): Pair<Boolean, JSONObject?>? {
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "PUT"
          connectTimeout = 25_000
          readTimeout = 35_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        }
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write(body.toString())
      }
      val code = conn.responseCode
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
      (code in 200..299) to json
    } catch (_: Exception) {
      null
    }
  }

  private fun postJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    body: JSONObject,
  ): Pair<Boolean, JSONObject?>? {
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = 25_000
          readTimeout = 35_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("Accept", "application/json")
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        }
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write(body.toString())
      }
      val code = conn.responseCode
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
      (code in 200..299) to json
    } catch (_: Exception) {
      null
    }
  }

  private fun patchJson(
    runtime: BlypShellRuntime.Snapshot,
    urlStr: String,
    body: JSONObject,
  ): Pair<Boolean, JSONObject?>? {
    return try {
      val conn =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
          requestMethod = "PATCH"
          connectTimeout = 25_000
          readTimeout = 35_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("Accept", "application/json")
          setRequestProperty("Authorization", "Bearer ${runtime.accessToken}")
        }
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { w ->
        w.write(body.toString())
      }
      val code = conn.responseCode
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
      (code in 200..299) to json
    } catch (_: Exception) {
      null
    }
  }
}
