package com.haroldndougou.blyp.shell

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object BlypShellSoaDayKey {
  private val ZONE = ZoneId.of("Africa/Douala")
  private val FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd")

  fun todayKey(): String = FMT.format(Instant.now().atZone(ZONE))
}
