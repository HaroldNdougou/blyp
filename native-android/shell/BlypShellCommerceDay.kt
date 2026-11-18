package com.haroldndougou.blyp.shell

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Jour recette commerce (Douala), aligné `soaDayKey.ts`. */
object BlypShellCommerceDay {
  private val DOUALA: ZoneId = ZoneId.of("Africa/Douala")

  fun todayKey(): String = LocalDate.now(DOUALA).toString()

  /** « yyyy-MM-dd HH:mm » à l'heure locale du téléphone (le serveur envoie de l'UTC). */
  fun localDateTimeLabel(iso: String): String {
    val t = iso.trim()
    return try {
      val dt =
        java.time.OffsetDateTime.parse(t)
          .atZoneSameInstant(ZoneId.systemDefault())
          .toLocalDateTime()
      "%04d-%02d-%02d %02d:%02d".format(dt.year, dt.monthValue, dt.dayOfMonth, dt.hour, dt.minute)
    } catch (_: Exception) {
      if (t.length >= 16) t.take(16).replace('T', ' ') else t.ifEmpty { "—" }
    }
  }

  fun dayKeyFromIso(iso: String): String {
    return try {
      val instant = Instant.parse(iso.trim())
      instant.atZone(DOUALA).toLocalDate().toString()
    } catch (_: Exception) {
      iso.trim().take(10)
    }
  }
}
