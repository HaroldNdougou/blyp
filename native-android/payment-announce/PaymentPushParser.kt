package com.haroldndougou.blyp.paymentannounce

import org.json.JSONObject

object PaymentPushParser {
  /** Expo / FCM — clés à plat ou JSON dans `body`. */
  fun parsePaymentReceived(data: Map<String, String>): Map<String, String>? {
    if (data["type"] == "payment_received") return data

    val bodyRaw = data["body"]?.trim().orEmpty()
    if (bodyRaw.startsWith("{")) {
      try {
        val json = JSONObject(bodyRaw)
        if (json.optString("type") != "payment_received") return null
        val out = mutableMapOf<String, String>()
        for (key in json.keys()) {
          val v = json.opt(key)
          if (v != null && v != JSONObject.NULL) out[key] = v.toString()
        }
        if (data["title"]?.isNotBlank() == true) out["title"] = data["title"]!!
        if (data["message"]?.isNotBlank() == true) out["message"] = data["message"]!!
        return out
      } catch (_: Exception) {
        return null
      }
    }
    return null
  }

  fun parseMessageReceived(data: Map<String, String>): Map<String, String>? {
    if (data["type"] == "message_received") return data

    val bodyRaw = data["body"]?.trim().orEmpty()
    if (bodyRaw.startsWith("{")) {
      try {
        val json = JSONObject(bodyRaw)
        if (json.optString("type") != "message_received") return null
        val out = mutableMapOf<String, String>()
        for (key in json.keys()) {
          val v = json.opt(key)
          if (v != null && v != JSONObject.NULL) out[key] = v.toString()
        }
        if (data["title"]?.isNotBlank() == true) out["title"] = data["title"]!!
        if (data["message"]?.isNotBlank() == true) out["message"] = data["message"]!!
        return out
      } catch (_: Exception) {
        return null
      }
    }
    return null
  }

  fun parseMoneyClaimed(data: Map<String, String>): Map<String, String>? {
    if (data["type"] == "money_claimed") return data

    val bodyRaw = data["body"]?.trim().orEmpty()
    if (bodyRaw.startsWith("{")) {
      try {
        val json = JSONObject(bodyRaw)
        if (json.optString("type") != "money_claimed") return null
        val out = mutableMapOf<String, String>()
        for (key in json.keys()) {
          val v = json.opt(key)
          if (v != null && v != JSONObject.NULL) out[key] = v.toString()
        }
        return out
      } catch (_: Exception) {
        return null
      }
    }
    return null
  }

  fun parseConversationReceipt(data: Map<String, String>): Map<String, String>? {
    return parseTyped(data, "conversation_receipt")
  }

  fun parseConversationTyping(data: Map<String, String>): Map<String, String>? {
    return parseTyped(data, "conversation_typing")
  }

  fun parseConversationPresence(data: Map<String, String>): Map<String, String>? {
    return parseTyped(data, "conversation_presence")
  }

  fun parseMoneyUpdated(data: Map<String, String>): Map<String, String>? {
    return parseTyped(data, "money_updated")
  }

  /** `money_thanks` — notif tray vers l’envoyeur. */
  fun parseMoneyTray(data: Map<String, String>): Map<String, String>? {
    val thanks = parseTyped(data, "money_thanks")
    if (thanks != null) return thanks + ("type" to "money_thanks")
    return null
  }

  private fun parseTyped(data: Map<String, String>, type: String): Map<String, String>? {
    if (data["type"] == type) return data

    val bodyRaw = data["body"]?.trim().orEmpty()
    if (bodyRaw.startsWith("{")) {
      try {
        val json = JSONObject(bodyRaw)
        if (json.optString("type") != type) return null
        val out = mutableMapOf<String, String>()
        for (key in json.keys()) {
          val v = json.opt(key)
          if (v != null && v != JSONObject.NULL) out[key] = v.toString()
        }
        return out
      } catch (_: Exception) {
        return null
      }
    }
    return null
  }
}
