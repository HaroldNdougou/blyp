package com.haroldndougou.blyp.shell

/** Throttle GET fil — aligné `lib/messages/threadPullGate.ts`. */
object BlypShellChatThreadPullGate {
  private const val MIN_INTERVAL_MS = 12_000L
  private val lastPullAt = HashMap<String, Long>()

  fun shouldPull(conversationId: String, hasCachedMessages: Boolean): Boolean {
    val id = conversationId.trim()
    if (id.isEmpty()) return false
    if (!hasCachedMessages) return true
    val last = lastPullAt[id] ?: 0L
    return System.currentTimeMillis() - last >= MIN_INTERVAL_MS
  }

  fun markPulled(conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    lastPullAt[id] = System.currentTimeMillis()
  }
}