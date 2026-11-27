package com.haroldndougou.blyp.shell

/** Throttle GET `/conversations` — aligné `lib/messages/conversationsListGate.ts`. */
object BlypShellConversationsListGate {
  private const val MIN_INTERVAL_MS = 15_000L
  @Volatile private var lastPullAtMs = 0L

  fun shouldPull(): Boolean {
    val now = System.currentTimeMillis()
    return now - lastPullAtMs >= MIN_INTERVAL_MS
  }

  fun markPulled() {
    lastPullAtMs = System.currentTimeMillis()
  }
}