package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import com.haroldndougou.blyp.MainActivity
import com.haroldndougou.blyp.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** Badges coque sans monter React — SQLite kv_cache + bump WS. */
object BlypShellBadgeNativeSync {
  private val io = Executors.newSingleThreadExecutor()
  @Volatile private var lastRunMs = 0L
  private const val MIN_MS = 45_000L

  /** Au démarrage / reprise coque — pas de throttle. */
  fun hydrateBadgesFromKv(context: Context) {
    io.execute {
      val app = context.applicationContext
      val accountId = BlypShellSession.accountId(app)?.trim().orEmpty()
      if (accountId.isNotEmpty()) {
        val receipts = readReceiptsUnread(app, accountId)
        BlypShellSession.syncReceiptsUnread(app, receipts)
      }
      BlypShellUiRefresh.notifyShellBadgesChanged()
    }
  }

  fun refreshFromLocalCache(context: Context) {
    val now = System.currentTimeMillis()
    if (now - lastRunMs < MIN_MS) return
    lastRunMs = now
    hydrateBadgesFromKv(context)
  }

  fun applyMessagesUnread(context: Context, count: Int, writeKv: Boolean = true) {
    val app = context.applicationContext
    val n = count.coerceAtLeast(0)
    BlypShellSession.syncMessagesUnread(app, n)
    if (writeKv) {
      val accountId = BlypShellSession.accountId(app)?.trim().orEmpty()
      if (accountId.isNotEmpty()) {
        BlypShellKvCache.writeMessagesUnreadTotal(app, accountId, n)
      }
    }
    BlypShellUiRefresh.notifyMessagesBadgeChanged()
  }

  fun bumpMessagesUnread(context: Context) {
    val app = context.applicationContext
    val accountId = BlypShellSession.accountId(app)?.trim().orEmpty()
    val fromKv =
      if (accountId.isNotEmpty()) {
        BlypShellKvCache.readMessagesUnreadTotal(app, accountId)
      } else {
        0
      }
    val base = maxOf(fromKv, BlypShellSession.messagesUnread(app))
    applyMessagesUnread(app, base + 1, writeKv = true)
  }

  private fun readReceiptsUnread(context: Context, accountId: String): Int {
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return 0
    return try {
      db.rawQuery(
        "SELECT json FROM kv_cache WHERE phone = ? AND key = ? LIMIT 1",
        arrayOf(accountId, BlypShellKvCache.KEY_RECEIPTS_UNREAD),
      ).use { c ->
        if (!c.moveToFirst()) return 0
        val json = c.getString(0).orEmpty()
        val arr = JSONObject(json).optJSONArray("ids") ?: JSONArray()
        arr.length().coerceAtLeast(0)
      }
    } catch (_: Exception) {
      0
    } finally {
      db.close()
    }
  }
}

object BlypShellEntry {
  fun isNativeShellLauncher(context: Context): Boolean {
    return runCatching {
      context.resources.getBoolean(R.bool.blyp_native_shell_launcher)
    }.getOrDefault(false)
  }

  fun primaryTaskIntent(context: Context): Intent {
    return if (isNativeShellLauncher(context)) {
      shellHomeIntent(context)
    } else {
      Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
    }
  }

  /** Toujours Payer, jamais Messages — y compris depuis une notification. */
  fun shellHomeIntent(context: Context): Intent {
    return Intent(context, BlypNativeShellActivity::class.java).apply {
      flags =
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra(BlypNativeShellActivity.EXTRA_OPEN_PAY, true)
    }
  }
}
