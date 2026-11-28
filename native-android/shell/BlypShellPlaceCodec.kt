package com.haroldndougou.blyp.shell

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.net.URLEncoder

/** Position partagée : texte sync type réactions, plié en bulle « place ». */
object BlypShellPlaceCodec {
  const val LIVE_MS = 15L * 60_000L
  private const val START = "BLYP_P|"
  private const val UPDATE = "BLYP_PU|"
  private const val STOP = "BLYP_PS|"

  data class Place(
    val sessionId: String,
    val lat: Double,
    val lng: Double,
    val expiresAtMs: Long,
    val stopped: Boolean,
    val name: String = "",
    val note: String = "",
  ) {
    val fixed: Boolean
      get() = expiresAtMs <= 0L
    val live: Boolean
      get() = !fixed && !stopped && System.currentTimeMillis() < expiresAtMs
  }

  fun encodeStart(
    sessionId: String,
    lat: Double,
    lng: Double,
    expiresAtMs: Long,
    stopped: Boolean = false,
    name: String = "",
    note: String = "",
  ): String {
    val stopBit = if (stopped || expiresAtMs <= 0L) "1" else "0"
    val encName = encodeField(name, 80)
    val encNote = encodeField(note, 120)
    return "$START$sessionId|${fmt(lat)}|${fmt(lng)}|$expiresAtMs|$stopBit|$encName|$encNote"
  }

  fun encodeUpdate(sessionId: String, lat: Double, lng: Double): String =
    "$UPDATE$sessionId|${fmt(lat)}|${fmt(lng)}"

  fun encodeStop(sessionId: String): String = "$STOP$sessionId"

  fun parseUpdate(body: String?): Triple<String, Double, Double>? {
    val rest = strip(body, UPDATE) ?: return null
    val parts = rest.split('|')
    if (parts.size < 3) return null
    val sessionId = parts[0].trim()
    val lat = parts[1].toDoubleOrNull() ?: return null
    val lng = parts[2].toDoubleOrNull() ?: return null
    if (sessionId.isEmpty()) return null
    return Triple(sessionId, lat, lng)
  }

  fun parseStop(body: String?): String? {
    val rest = strip(body, STOP) ?: return null
    val sessionId = rest.substringBefore('|').trim()
    return sessionId.ifEmpty { null }
  }

  fun isSyncBody(body: String?): Boolean =
    parseUpdate(body) != null || parseStop(body) != null

  fun isPlaceBody(body: String?): Boolean = parsePlaceBody(body) != null

  fun mapsUrl(lat: Double, lng: Double): String =
    "https://maps.google.com/?q=$lat,$lng"

  /** Retire PU/PS et applique la dernière position / arrêt sur la bulle de départ. */
  fun foldRaw(items: List<JSONObject>): List<JSONObject> {
    if (items.isEmpty()) return items
    val updates = HashMap<String, Pair<Double, Double>>()
    val stopped = HashSet<String>()
    val visible = ArrayList<JSONObject>(items.size)
    for (o in items) {
      if (o.optString("type", "text") != "text") {
        visible.add(o)
        continue
      }
      val body = o.optString("body", "")
      val upd = parseUpdate(body)
      if (upd != null) {
        updates[upd.first] = upd.second to upd.third
        continue
      }
      val stopId = parseStop(body)
      if (stopId != null) {
        stopped.add(stopId)
        continue
      }
      visible.add(o)
    }
    if (updates.isEmpty() && stopped.isEmpty()) return visible
    return visible.map { o ->
      if (o.optString("type", "text") != "text") return@map o
      val place = parsePlaceBody(o.optString("body", "")) ?: return@map o
      val latest = updates[place.sessionId]
      val isStopped = place.sessionId in stopped || place.stopped
      if (latest == null && !isStopped) return@map o
      val lat = latest?.first ?: place.lat
      val lng = latest?.second ?: place.lng
      val body =
        encodeStart(
          place.sessionId,
          lat,
          lng,
          place.expiresAtMs,
          stopped = isStopped,
          name = place.name,
          note = place.note,
        )
      JSONObject(o.toString()).put("body", body)
    }
  }

  fun parsePlaceBody(body: String?): Place? {
    val raw = body?.trim().orEmpty()
    if (!raw.startsWith(START)) return null
    val parts = raw.removePrefix(START).split('|')
    if (parts.size < 4) return null
    val sessionId = parts[0].trim()
    val lat = parts[1].toDoubleOrNull() ?: return null
    val lng = parts[2].toDoubleOrNull() ?: return null
    val expires = parts[3].toLongOrNull() ?: return null
    val stopped = parts.getOrNull(4) == "1" || expires <= 0L
    val name = decodeField(parts.getOrNull(5).orEmpty())
    val note = decodeField(parts.getOrNull(6).orEmpty())
    if (sessionId.isEmpty()) return null
    return Place(sessionId, lat, lng, expires, stopped, name, note)
  }

  fun previewLabel(place: Place, liveFallback: String, fixedFallback: String): String {
    val note = place.note.trim()
    val name = BlypShellPlaceName.sanitize(place.name)
    return when {
      note.isNotEmpty() && name.isNotEmpty() -> "📍 $note · $name"
      note.isNotEmpty() -> "📍 $note"
      name.isNotEmpty() -> "📍 $name"
      place.live -> liveFallback
      else -> fixedFallback
    }
  }

  fun previewFromBody(
    body: String?,
    liveFallback: String,
    fixedFallback: String,
  ): String? {
    val place = parsePlaceBody(body) ?: return null
    return previewLabel(place, liveFallback, fixedFallback)
  }

  private fun encodeField(value: String, max: Int): String {
    val clean = value.trim().take(max)
    if (clean.isEmpty()) return ""
    return try {
      URLEncoder.encode(clean, Charsets.UTF_8.name())
    } catch (_: Exception) {
      ""
    }
  }

  private fun decodeField(raw: String): String {
    val t = raw.trim()
    if (t.isEmpty()) return ""
    return try {
      URLDecoder.decode(t, Charsets.UTF_8.name()).trim()
    } catch (_: Exception) {
      t
    }
  }

  private fun strip(body: String?, prefix: String): String? {
    val raw = body?.trim().orEmpty()
    if (!raw.startsWith(prefix)) return null
    return raw.removePrefix(prefix)
  }

  private fun fmt(v: Double): String = String.format(java.util.Locale.US, "%.6f", v)

  fun foldArray(arr: JSONArray): JSONArray {
    val list = ArrayList<JSONObject>(arr.length())
    for (i in 0 until arr.length()) {
      arr.optJSONObject(i)?.let { list.add(it) }
    }
    val folded = foldRaw(list)
    return JSONArray().apply { for (o in folded) put(o) }
  }
}
