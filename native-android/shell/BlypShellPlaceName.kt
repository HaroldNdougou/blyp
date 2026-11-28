package com.haroldndougou.blyp.shell

import android.content.Context
import android.location.Geocoder
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Nom lisible du lieu (ex. Poste centrale) à partir des coordonnées. */
object BlypShellPlaceName {
  private val PLUS_CODE =
    Regex("""(?i)\b[2-9C-HJ-NP-TV-X]{4,8}\+[2-9C-HJ-NP-TV-X]{2,3}\b""")

  fun resolve(context: Context, lat: Double, lng: Double): String {
    val local = resolveLocal(context, lat, lng)
    if (local.isNotEmpty()) return local
    val photon = resolvePhoton(lat, lng)
    if (photon.isNotEmpty()) return photon
    return resolveNominatim(lat, lng)
  }

  /** Garde seulement un libellé humain (rejette codes plus, n° seuls, etc.). */
  fun sanitize(raw: String?): String {
    val t = raw?.trim().orEmpty()
    if (t.isEmpty() || isUglyLabel(t)) return ""
    return t.take(80)
  }

  private fun resolveLocal(context: Context, lat: Double, lng: Double): String {
    if (!Geocoder.isPresent()) return ""
    return try {
      if (Build.VERSION.SDK_INT >= 33) {
        resolveAsync(context, lat, lng)
      } else {
        @Suppress("DEPRECATION")
        val list = Geocoder(context, Locale.getDefault()).getFromLocation(lat, lng, 3)
        labelFromAddresses(list)
      }
    } catch (_: Exception) {
      ""
    }
  }

  private fun resolveAsync(context: Context, lat: Double, lng: Double): String {
    val out = AtomicReference("")
    val done = CountDownLatch(1)
    try {
      Geocoder(context, Locale.getDefault()).getFromLocation(lat, lng, 3) { list ->
        out.set(labelFromAddresses(list))
        done.countDown()
      }
      done.await(2, TimeUnit.SECONDS)
    } catch (_: Exception) {
      done.countDown()
    }
    return out.get()
  }

  private fun resolvePhoton(lat: Double, lng: Double): String {
    val raw = httpGet("https://photon.komoot.io/reverse?lon=$lng&lat=$lat") ?: return ""
    return try {
      val feats = JSONObject(raw).optJSONArray("features") ?: return ""
      for (i in 0 until minOf(feats.length(), 5)) {
        val props = feats.optJSONObject(i)?.optJSONObject("properties") ?: continue
        val label =
          pickLabel(
            props.optString("name"),
            props.optString("street"),
            props.optString("district"),
            props.optString("locality"),
            props.optString("city"),
            props.optString("county"),
            props.optString("state"),
          )
        if (label.isNotEmpty()) return label
      }
      ""
    } catch (_: Exception) {
      ""
    }
  }

  private fun resolveNominatim(lat: Double, lng: Double): String {
    val lang = Locale.getDefault().language.ifEmpty { "fr" }
    val url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=$lat&lon=$lng&zoom=18&addressdetails=1"
    val raw = httpGet(url, mapOf("Accept-Language" to lang)) ?: return ""
    return try {
      val root = JSONObject(raw)
      val addr = root.optJSONObject("address")
      if (addr != null) {
        pickLabel(
          addr.optString("amenity"),
          addr.optString("shop"),
          addr.optString("building"),
          addr.optString("tourism"),
          addr.optString("leisure"),
          addr.optString("neighbourhood"),
          addr.optString("suburb"),
          addr.optString("quarter"),
          addr.optString("village"),
          addr.optString("town"),
          addr.optString("city"),
          addr.optString("road"),
          addr.optString("pedestrian"),
          addr.optString("hamlet"),
        )
      } else {
        sanitize(root.optString("name"))
      }
    } catch (_: Exception) {
      ""
    }
  }

  private fun labelFromAddresses(list: List<android.location.Address>?): String {
    if (list.isNullOrEmpty()) return ""
    for (addr in list) {
      val label =
        pickLabel(
          addr.featureName.orEmpty(),
          addr.thoroughfare.orEmpty(),
          addr.subLocality.orEmpty(),
          addr.locality.orEmpty(),
          addr.subAdminArea.orEmpty(),
        )
      if (label.isNotEmpty()) return label
    }
    return ""
  }

  private fun pickLabel(vararg values: String): String {
    val picked = values.map { it.trim() }.filter { it.isNotEmpty() && !isUglyLabel(it) }
    return (picked.firstOrNull { !looksLikeCodedRoad(it) } ?: picked.firstOrNull())
      .orEmpty()
      .take(80)
  }

  private fun httpGet(url: String, extraHeaders: Map<String, String> = emptyMap()): String? {
    return try {
      val conn = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 4500
        readTimeout = 5000
        requestMethod = "GET"
        setRequestProperty("User-Agent", "BlypPlace/1.0 (https://blyp.app; reverse-geocode)")
        for ((k, v) in extraHeaders) setRequestProperty(k, v)
      }
      conn.inputStream.bufferedReader().use { it.readText() }.also { conn.disconnect() }
    } catch (_: Exception) {
      null
    }
  }

  fun isUglyLabel(s: String): Boolean {
    val t = s.trim()
    if (t.isEmpty()) return true
    if (looksLikeCoords(t)) return true
    if (PLUS_CODE.containsMatchIn(t)) return true
    if (t.matches(Regex("""^\d+[A-Za-z]?$"""))) return true
    if (t.equals("Unnamed Road", ignoreCase = true) || t.equals("Unnamed", ignoreCase = true)) {
      return true
    }
    if (t.equals("null", ignoreCase = true) || t.equals("undefined", ignoreCase = true)) {
      return true
    }
    if (looksLikeCodedRoad(t)) return true
    return false
  }

  private fun looksLikeCoords(s: String): Boolean =
    s.contains(',') && s.any { it.isDigit() } && s.count { it == '.' } >= 1

  private fun looksLikeCodedRoad(s: String): Boolean =
    Regex("""(?i)^(rue|av\.?|avenue|bd\.?|boulevard)\s*[\d.]+$""").containsMatchIn(s.trim())
}
