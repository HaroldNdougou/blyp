package com.haroldndougou.blyp.realtime

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object BlypWsFrame {
  private const val HEADER_LEN = 9
  private const val VERSION: Int = 1
  private const val FLAG_COMPACT = 1

  const val OP_PING: Int = 0x01
  const val OP_PONG: Int = 0x02
  const val OP_PAYMENT_RECEIVED: Int = 0x10
  const val OP_CHAT_JSON: Int = 0x20
  const val OP_CONVERSATION_PRESENCE: Int = 0x21
  const val OP_CONVERSATION_TYPING: Int = 0x22

  fun encodePing(): ByteArray = buildHeader(OP_PING, 0, 0)

  fun encodeClientAction(json: String): ByteArray {
    val obj = JSONObject(json)
    val action = obj.optString("action", "").lowercase()
    if (action == "ping") return encodePing()
    val payload = json.toByteArray(StandardCharsets.UTF_8)
    return concat(buildHeader(OP_CHAT_JSON, payload.size, 0), payload)
  }

  fun decode(data: ByteArray): JSONObject? {
    if (data.size < HEADER_LEN) return null
    if (data[0] != 0x42.toByte() || data[1] != 0x59.toByte()) return null
    if (data[2].toInt() != VERSION) return null
    val flags = data[3].toInt()
    val opcode = data[4].toInt()
    val len = readU32(data, 5)
    if (HEADER_LEN + len > data.size) return null
    val payload = data.copyOfRange(HEADER_LEN, HEADER_LEN + len)
    return when (opcode) {
      OP_PONG -> JSONObject().put("type", "pong")
      OP_PING -> JSONObject().put("action", "ping")
      OP_PAYMENT_RECEIVED ->
        if (flags and FLAG_COMPACT != 0) decodePaymentCompact(payload)
        else JSONObject(String(payload, StandardCharsets.UTF_8))
      OP_CHAT_JSON -> JSONObject(String(payload, StandardCharsets.UTF_8))
      OP_CONVERSATION_PRESENCE ->
        if (flags and FLAG_COMPACT != 0) decodePresenceCompact(payload) else null
      OP_CONVERSATION_TYPING ->
        if (flags and FLAG_COMPACT != 0) decodeTypingCompact(payload) else null
      else -> null
    }
  }

  private fun isoFromUnixSec(sec: Int): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    fmt.timeZone = TimeZone.getTimeZone("UTC")
    return fmt.format(Date(sec.toLong() * 1000L))
  }

  private fun decodePresenceCompact(payload: ByteArray): JSONObject? {
    if (payload.size < 6) return null
    var o = 0
    val convLen = payload[o++].toInt() and 0xff
    if (o + convLen + 4 > payload.size) return null
    val conversationId = String(payload, o, convLen, StandardCharsets.UTF_8)
    o += convLen
    val atSec = readU32(payload, o)
    return JSONObject()
      .put("type", "conversation_presence")
      .put("conversationId", conversationId)
      .put("at", isoFromUnixSec(atSec))
  }

  private fun decodeTypingCompact(payload: ByteArray): JSONObject? {
    if (payload.size < 3) return null
    var o = 0
    val convLen = payload[o++].toInt() and 0xff
    if (o + convLen + 1 > payload.size) return null
    val conversationId = String(payload, o, convLen, StandardCharsets.UTF_8)
    o += convLen
    val flags = payload[o++].toInt() and 0xff
    val on = flags and 1 != 0
    var fromName = ""
    if (flags and 2 != 0) {
      if (o >= payload.size) return null
      val nameLen = payload[o++].toInt() and 0xff
      if (o + nameLen > payload.size) return null
      fromName = String(payload, o, nameLen, StandardCharsets.UTF_8)
      o += nameLen
    }
    val out =
      JSONObject()
        .put("type", "conversation_typing")
        .put("conversationId", conversationId)
        .put("on", if (on) "1" else "0")
    if (fromName.isNotEmpty()) out.put("fromName", fromName)
    if (flags and 4 != 0) {
      if (o + 4 > payload.size) return null
      out.put("presenceAt", isoFromUnixSec(readU32(payload, o)))
    }
    return out
  }

  private fun decodePaymentCompact(payload: ByteArray): JSONObject? {
    if (payload.size < 8) return null
    var o = 0
    val txLen = payload[o++].toInt() and 0xff
    if (o + txLen + 4 > payload.size) return null
    val txId = String(payload, o, txLen, StandardCharsets.UTF_8)
    o += txLen
    val amount = readU32(payload, o)
    o += 4
    if (o >= payload.size) return null
    val nameLen = payload[o++].toInt() and 0xff
    if (o + nameLen + 2 > payload.size) return null
    val fromName = String(payload, o, nameLen, StandardCharsets.UTF_8)
    o += nameLen
    val ctx = payload[o++].toInt() and 0xff
    val commerceLen = payload[o++].toInt() and 0xff
    if (o + commerceLen > payload.size) return null
    val commerceId =
      if (commerceLen > 0) String(payload, o, commerceLen, StandardCharsets.UTF_8) else null
    return JSONObject()
      .put("type", "payment_received")
      .put("transactionId", txId)
      .put("amountFcfa", amount)
      .put("fromName", fromName)
      .put("contextType", if (ctx == 1) "commerce" else "personal")
      .put("commerceId", commerceId)
  }

  private fun buildHeader(opcode: Int, payloadLen: Int, flags: Int): ByteArray {
    val h = ByteArray(HEADER_LEN)
    h[0] = 0x42
    h[1] = 0x59
    h[2] = VERSION.toByte()
    h[3] = flags.toByte()
    h[4] = opcode.toByte()
    writeU32(h, 5, payloadLen)
    return h
  }

  private fun readU32(buf: ByteArray, off: Int): Int {
    return ((buf[off].toInt() and 0xff) shl 24) or
      ((buf[off + 1].toInt() and 0xff) shl 16) or
      ((buf[off + 2].toInt() and 0xff) shl 8) or
      (buf[off + 3].toInt() and 0xff)
  }

  private fun writeU32(buf: ByteArray, off: Int, v: Int) {
    val n = v
    buf[off] = ((n ushr 24) and 0xff).toByte()
    buf[off + 1] = ((n ushr 16) and 0xff).toByte()
    buf[off + 2] = ((n ushr 8) and 0xff).toByte()
    buf[off + 3] = (n and 0xff).toByte()
  }

  private fun concat(a: ByteArray, b: ByteArray): ByteArray {
    return ByteBuffer.allocate(a.size + b.size).put(a).put(b).array()
  }
}
