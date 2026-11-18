package com.haroldndougou.blyp.shell

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File

/** Lecture / écriture `kv_cache` (aligné RN `runDbWrite`). */
object BlypShellKvCache {
  const val KEY_MESSAGES_UNREAD_TOTAL = "messages_unread_total"
  const val KEY_RECEIPTS_UNREAD = "receipts_unread"

  fun readMessagesUnreadTotal(context: Context, accountId: String): Int {
    val id = accountId.trim()
    if (id.isEmpty()) return 0
    val db = openDb(context, writable = false) ?: return 0
    return try {
      db.rawQuery(
        "SELECT json FROM kv_cache WHERE phone = ? AND key = ? LIMIT 1",
        arrayOf(id, KEY_MESSAGES_UNREAD_TOTAL),
      ).use { c ->
        if (!c.moveToFirst()) return 0
        JSONObject(c.getString(0).orEmpty()).optInt("total", 0).coerceAtLeast(0)
      }
    } catch (_: Exception) {
      0
    } finally {
      db.close()
    }
  }

  fun writeMessagesUnreadTotal(context: Context, accountId: String, total: Int) {
    val id = accountId.trim()
    if (id.isEmpty()) return
    val db = openDb(context, writable = true) ?: return
    try {
      val json = JSONObject().put("total", total.coerceAtLeast(0)).toString()
      db.execSQL(
        "INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)",
        arrayOf(id, KEY_MESSAGES_UNREAD_TOTAL, json),
      )
    } catch (_: Exception) {
      /* ignore */
    } finally {
      db.close()
    }
  }

  fun openDb(context: Context, writable: Boolean): SQLiteDatabase? {
    val flag =
      if (writable) SQLiteDatabase.OPEN_READWRITE else SQLiteDatabase.OPEN_READONLY
    val paths =
      listOf(
        File(context.filesDir, "SQLite/blyp.db"),
        context.getDatabasePath("blyp.db"),
        File(context.filesDir, "blyp.db"),
      )
    for (path in paths) {
      if (!path.isFile) continue
      return try {
        SQLiteDatabase.openDatabase(path.absolutePath, null, flag)
      } catch (_: Exception) {
        null
      }
    }
    return null
  }
}
