package com.haroldndougou.blyp.shell

import android.content.Context

/** Messages qui partent au bout de 5 minutes, et chat qui ne se garde pas. */
object BlypShellChatModes {
  private const val PREFS = "blyp_shell_chat_modes"
  private const val VANISH_MS = 5L * 60L * 1000L

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun vanishOn(context: Context, conversationId: String): Boolean =
    prefs(context).getBoolean("v$conversationId", false)

  fun setVanish(context: Context, conversationId: String, on: Boolean) {
    prefs(context)
      .edit()
      .putBoolean("v$conversationId", on)
      .putLong("va$conversationId", System.currentTimeMillis())
      .apply()
  }

  fun incognito(context: Context, conversationId: String): Boolean =
    prefs(context).getBoolean("i$conversationId", false)

  fun setIncognito(context: Context, conversationId: String, on: Boolean) {
    prefs(context).edit().putBoolean("i$conversationId", on).apply()
  }

  fun seal(context: Context, conversationId: String) {
    prefs(context).edit().putLong("cut$conversationId", System.currentTimeMillis()).apply()
  }

  fun keep(context: Context, conversationId: String, createdAt: String): Boolean {
    val created = parse(createdAt) ?: return true
    val p = prefs(context)
    val cut = p.getLong("cut$conversationId", 0L)
    if (cut > 0L && created <= cut) return false
    if (!p.getBoolean("v$conversationId", false)) return true
    val arm = p.getLong("va$conversationId", 0L)
    if (arm <= 0L || created < arm) return true
    return System.currentTimeMillis() - created < VANISH_MS
  }

  private fun parse(iso: String): Long? =
    try {
      java.time.Instant.parse(iso).toEpochMilli()
    } catch (_: Exception) {
      null
    }
}
