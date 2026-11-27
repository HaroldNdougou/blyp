package com.haroldndougou.blyp.shell

import android.content.Context
import android.database.sqlite.SQLiteDatabaseLockedException
import com.haroldndougou.blyp.R
import org.json.JSONArray
import org.json.JSONObject

data class ShellConversationRow(
  val id: String,
  val peerName: String,
  val peerPhone: String?,
  val avatarUrl: String?,
  val preview: String,
  val whenLabel: String,
  val sortAt: String,
  val isDemo: Boolean,
)

object BlypShellConversationsStore {
  private const val DEMO_PREFIX = "demo-conv-"

  fun isDemoId(id: String): Boolean = id.startsWith(DEMO_PREFIX)

  fun loadRows(context: Context, phoneRaw: String): List<ShellConversationRow> {
    val phone = phoneRaw.trim()
    if (phone.isEmpty()) return emptyList()
    repeat(4) { attempt ->
      val db = BlypShellKvCache.openDb(context, writable = false) ?: return emptyList()
      try {
        return loadRowsFromDb(context, db, phone)
      } catch (_: SQLiteDatabaseLockedException) {
        if (attempt == 3) return emptyList()
        Thread.sleep(20L * (attempt + 1))
      } finally {
        db.close()
      }
    }
    return emptyList()
  }

  private fun loadRowsFromDb(
    context: Context,
    db: android.database.sqlite.SQLiteDatabase,
    phone: String,
  ): List<ShellConversationRow> {
    return try {
      val cursor =
        db.rawQuery(
          "SELECT json, updatedAt FROM conversations WHERE phone = ? ORDER BY updatedAt DESC",
          arrayOf(phone),
        )
      val parsed = ArrayList<ShellConversationRow>()
      cursor.use {
        while (it.moveToNext()) {
          val json = it.getString(0)?.trim().orEmpty()
          if (json.isEmpty()) continue
          rowFromJson(context, json)?.let { parsed.add(it) }
        }
      }
      sortLikeRn(parsed)
    } catch (e: SQLiteDatabaseLockedException) {
      throw e
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun rowsEqual(a: List<ShellConversationRow>, b: List<ShellConversationRow>): Boolean {
    if (a.size != b.size) return false
    for (i in a.indices) {
      val x = a[i]
      val y = b[i]
      if (
        x.id != y.id ||
        x.preview != y.preview ||
        x.whenLabel != y.whenLabel ||
        x.peerName != y.peerName ||
        x.sortAt != y.sortAt
      ) {
        return false
      }
    }
    return true
  }

  fun touchIncoming(
    context: Context,
    ownerPhone: String,
    conversationId: String,
    preview: String,
    at: String,
    fromName: String,
  ) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val meta =
      BlypShellChatMessagesStore.conversationMeta(context, ownerPhone, id)
        ?: JSONObject().put("id", id)
    val name = fromName.trim()
    if (meta.optString("peerName").trim().isEmpty() && name.isNotEmpty()) {
      meta.put("peerName", name)
    }
    meta.put("id", id)
    meta.put("lastMessagePreview", preview.trim())
    meta.put("lastMessageAt", at)
    meta.put("updatedAt", at)
    upsertOne(context, ownerPhone, meta)
  }

  fun findIdByPeerPhone(context: Context, ownerPhone: String, phoneDigits: String): String? {
    val owner = ownerPhone.trim()
    val nine = BlypShellAuthClient.normalizePhoneDigits(phoneDigits) ?: return null
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return null
    return try {
      db.rawQuery(
        "SELECT id, json FROM conversations WHERE phone = ?",
        arrayOf(owner),
      ).use { c ->
        while (c.moveToNext()) {
          val raw = c.getString(1)?.trim().orEmpty()
          if (raw.isEmpty()) continue
          val o = try {
            JSONObject(raw)
          } catch (_: Exception) {
            continue
          }
          val peer = o.optString("peerPhone").trim()
          val peerNine = BlypShellAuthClient.normalizePhoneDigits(peer) ?: continue
          if (peerNine == nine) return c.getString(0)?.trim().orEmpty()
        }
        null
      }
    } catch (_: Exception) {
      null
    } finally {
      db.close()
    }
  }

  fun touchOpened(
    context: Context,
    ownerPhone: String,
    conversationId: String,
    peerName: String?,
    peerPhone: String?,
  ) {
    val owner = ownerPhone.trim()
    val id = conversationId.trim()
    if (owner.isEmpty() || id.isEmpty()) return
    val now = java.time.Instant.now().toString()
    val meta =
      BlypShellChatMessagesStore.conversationMeta(context, owner, id)
        ?: JSONObject().put("id", id)
    meta.put("id", id)
    meta.put("shellKeepInList", true)
    peerName?.trim()?.takeIf { it.isNotEmpty() }?.let { meta.put("peerName", it) }
    peerPhone?.trim()?.takeIf { it.isNotEmpty() }?.let { meta.put("peerPhone", it) }
    if (meta.optString("updatedAt").trim().isEmpty()) meta.put("updatedAt", now)
    if (meta.optString("lastMessageAt").trim().isEmpty()) meta.put("lastMessageAt", now)
    upsertOne(context, owner, meta)
  }

  fun upsertOne(context: Context, ownerPhone: String, conv: JSONObject): Boolean {
    val phone = ownerPhone.trim()
    val id = conv.optString("id").trim()
    if (phone.isEmpty() || id.isEmpty()) return false
    val updatedAt =
      conv.optString("updatedAt").trim().ifEmpty {
        conv.optString("lastMessageAt").trim()
      }
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return false
    return try {
      db.execSQL(
        "INSERT OR REPLACE INTO conversations (phone, id, json, updatedAt) VALUES (?, ?, ?, ?)",
        arrayOf(phone, id, conv.toString(), updatedAt),
      )
      true
    } catch (_: Exception) {
      false
    } finally {
      db.close()
    }
  }

  fun replaceAll(context: Context, phoneRaw: String, items: JSONArray): Boolean {
    val phone = phoneRaw.trim()
    if (phone.isEmpty()) return false
    val myId = BlypShellRuntime.accessSubject(context)
    val staged = ArrayList<Triple<String, String, String>>()
    for (i in 0 until items.length()) {
      val raw = items.optJSONObject(i) ?: continue
      val o = try {
        JSONObject(raw.toString())
      } catch (_: Exception) {
        continue
      }
      val id = o.optString("id").trim()
      if (id.isEmpty()) continue
      BlypShellConversationPreview.applyLocalThreadPreview(context, phone, o, myId)
      if (!keepConversation(context, o)) continue
      val updatedAt =
        o.optString("updatedAt").trim().ifEmpty {
          o.optString("lastMessageAt").trim()
        }
      staged.add(Triple(id, o.toString(), updatedAt))
    }
    val pinned = loadPinnedLocals(context, phone)
    val have = staged.map { it.first }.toMutableSet()
    for (p in pinned) {
      val id = p.optString("id").trim()
      if (id.isEmpty() || have.contains(id)) continue
      val updatedAt =
        p.optString("updatedAt").trim().ifEmpty {
          p.optString("lastMessageAt").trim()
        }
      staged.add(Triple(id, p.toString(), updatedAt))
      have.add(id)
    }
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return false
    return try {
      db.beginTransaction()
      try {
        db.execSQL("DELETE FROM conversations WHERE phone = ?", arrayOf(phone))
        for ((id, json, updatedAt) in staged) {
          db.execSQL(
            "INSERT INTO conversations (phone, id, json, updatedAt) VALUES (?, ?, ?, ?)",
            arrayOf(phone, id, json, updatedAt),
          )
        }
        db.setTransactionSuccessful()
        true
      } finally {
        db.endTransaction()
      }
    } catch (_: Exception) {
      false
    } finally {
      db.close()
    }
  }

  private fun loadPinnedLocals(context: Context, phone: String): List<JSONObject> {
    val out = ArrayList<JSONObject>()
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return out
    return try {
      db.rawQuery(
        "SELECT json FROM conversations WHERE phone = ?",
        arrayOf(phone.trim()),
      ).use { c ->
        while (c.moveToNext()) {
          val raw = c.getString(0)?.trim().orEmpty()
          if (raw.isEmpty()) continue
          val o =
            try {
              JSONObject(raw)
            } catch (_: Exception) {
              continue
            }
          val id = o.optString("id").trim()
          if (id.isEmpty()) continue
          if (
            o.optBoolean("shellKeepInList") ||
              BlypShellChatDraft.hasAny(context, id) ||
              o.optString("draftPreview").trim().isNotEmpty()
          ) {
            out.add(o)
          }
        }
        out
      }
    } catch (_: Exception) {
      out
    } finally {
      db.close()
    }
  }

  private fun keepConversation(context: Context, o: JSONObject): Boolean {
    if (unnamedPeer(o.optString("peerName"))) return false
    val id = o.optString("id").trim()
    if (o.optBoolean("shellKeepInList")) return true
    if (id.isNotEmpty() && BlypShellChatDraft.hasAny(context, id)) return true
    val draftPreview = o.optString("draftPreview").trim()
    if (draftPreview.isNotEmpty()) return true
    val lastAt = o.optString("lastMessageAt").trim()
    val cut = BlypShellChatHistoryWipe.cutoff(context)
    val preview =
      if (cut != null && (lastAt.isEmpty() || lastAt <= cut)) {
        ""
      } else {
        o.optString("lastMessagePreview", "").trim()
      }
    return preview.isNotEmpty()
  }

  private fun unnamedPeer(raw: String): Boolean {
    val name = raw.trim()
    if (name.isEmpty() || name == "?" || name == "…") return true
    if (name.any { it.isLetter() }) return false
    return name.any { it.isDigit() }
  }

  private fun sortLikeRn(rows: List<ShellConversationRow>): List<ShellConversationRow> {
    val real = rows.filter { !it.isDemo }
    val demo = rows.filter { it.isDemo }
    val byActivity = compareByDescending<ShellConversationRow> { it.sortAt }
    return real.sortedWith(byActivity) + demo.sortedWith(byActivity)
  }

  private fun rowFromJson(context: Context, json: String): ShellConversationRow? {
    return try {
      val o = JSONObject(json)
      val id = o.optString("id").trim()
      if (id.isEmpty()) return null
      val storedName = o.optString("peerName").trim().ifEmpty { "?" }
      if (!keepConversation(context, o)) return null
      val peerPhone = o.optString("peerPhone").trim().ifEmpty { null }
      val peerName = BlypShellPhoneContacts.labelFor(context, peerPhone, storedName)
      val avatarStored = o.optString("peerAvatarUrl").trim().ifEmpty { null }
      val avatarUrl =
        avatarStored ?: BlypShellPeerAvatar.urlForPhone(context, peerPhone)
      val lastAt = o.optString("lastMessageAt").trim()
      val cut = BlypShellChatHistoryWipe.cutoff(context)
      val draftLine = o.optString("draftPreview").trim()
      val preview =
        draftLine.ifEmpty {
          if (cut != null && (lastAt.isEmpty() || lastAt <= cut)) {
            ""
          } else {
            o.optString("lastMessagePreview", "").trim()
          }
        }.ifEmpty {
          BlypShellChatDraft.listPreviewLine(context, id).orEmpty()
        }.ifEmpty {
          if (o.optBoolean("shellKeepInList")) {
            context.getString(R.string.blyp_shell_messages_preview_empty)
          } else {
            ""
          }
        }
      val sortAt = lastAt.ifEmpty { o.optString("updatedAt").trim() }
      val whenLabel = BlypShellConversationWhen.format(context, sortAt.ifEmpty { null })
      ShellConversationRow(
        id = id,
        peerName = peerName,
        peerPhone = peerPhone,
        avatarUrl = avatarUrl,
        preview = preview,
        whenLabel = whenLabel,
        sortAt = sortAt,
        isDemo = isDemoId(id),
      )
    } catch (_: Exception) {
      null
    }
  }

}