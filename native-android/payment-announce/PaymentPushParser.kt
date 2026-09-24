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
}
