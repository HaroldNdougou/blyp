package com.haroldndougou.blyp.shell

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import com.haroldndougou.blyp.R
import java.io.File
import java.text.NumberFormat
import java.util.Locale
import org.json.JSONObject

data class ShellHistoryRow(
  val id: String,
  val name: String,
  val amountFcfa: Int,
  val amountLabel: String,
  /** Heure ou courte date affichée sous le nom. */
  val dateLabel: String,
  val createdAt: String,
  val type: String,
  val reference: String?,
  val counterpartyPhone: String?,
  val kind: String? = null,
) : java.io.Serializable

sealed class ShellHistoryItem {
  data class Header(val title: String, val total: String? = null) : ShellHistoryItem()
  data class Row(val row: ShellHistoryRow) : ShellHistoryItem()
}

enum class HistoryFilter {
  ALL,
  SENT,
  RECEIVED,
}

object BlypTransactionStore {
  private const val LIMIT = 80

  data class HistoryTotals(val sentFcfa: Int, val receivedFcfa: Int)

  /**
   * Clé de stockage : perso = téléphone ; mode pro = téléphone + commerce actif,
   * pour que la recette du commerce ne se mélange jamais avec le perso.
   */
  fun scopeKey(context: Context, phone: String): String {
    if (!BlypShellSession.isCommerceMode(context)) return phone
    val cid = BlypShellCommerceSession.activeCommerceId(context) ?: return phone
    return "$phone#$cid"
  }

  fun computeTotals(context: Context, phoneRaw: String): HistoryTotals {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadOnlyDb(context) ?: return HistoryTotals(0, 0)
    return try {
      var sent = 0
      var received = 0
      val cursor =
        db.rawQuery(
          """
          SELECT type, amountFcfa FROM transactions WHERE phone = ?
          """.trimIndent(),
          arrayOf(phone),
        )
      cursor.use {
        while (it.moveToNext()) {
          val type = it.getString(0) ?: continue
          val amount = it.getInt(1)
          if (amount <= 0) continue
          if (type == "received") received += amount else sent += amount
        }
      }
      HistoryTotals(sent, received)
    } catch (_: Exception) {
      HistoryTotals(0, 0)
    } finally {
      db.close()
    }
  }

  fun countOperations(context: Context, phoneRaw: String): Int {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadOnlyDb(context) ?: return 0
    return try {
      val cursor =
        db.rawQuery(
          "SELECT COUNT(*) FROM transactions WHERE phone = ?",
          arrayOf(phone),
        )
      cursor.use {
        if (!it.moveToFirst()) 0 else it.getInt(0)
      }
    } catch (_: Exception) {
      0
    } finally {
      db.close()
    }
  }

  fun loadHistoryItems(
    context: Context,
    phone: String,
    filter: HistoryFilter = HistoryFilter.ALL,
  ): List<ShellHistoryItem> {
    val rows = loadHistory(context, phone, filter)
    val commerce = BlypShellSession.isCommerceMode(context)
    val messageExtra =
      if (commerce) {
        loadHistory(context, phone, filter, scoped = false).filter { isMessageMoney(it) }
      } else {
        emptyList()
      }
    val messages =
      (rows.filter { isMessageMoney(it) } + messageExtra + loadAllMessageMoney(context, filter))
        .distinctBy { it.id }
        .sortedByDescending { it.createdAt }
    val messageIds = messages.map { it.id }.toSet()
    val rest = rows.filter { it.id !in messageIds && !isMessageMoney(it) }
    if (rest.isEmpty() && messages.isEmpty()) return emptyList()
    val out = ArrayList<ShellHistoryItem>()
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val fcfa = context.getString(R.string.blyp_shell_history_fcfa)
    val sums = LinkedHashMap<String, Int>()
    if (commerce) {
      for (row in rest) {
        if (row.type != "received") continue
        val key = formatSectionHeader(context, row.createdAt)
        sums[key] = (sums[key] ?: 0) + row.amountFcfa
      }
    }
    var lastSection: String? = null
    for (row in rest) {
      val section = formatSectionHeader(context, row.createdAt)
      if (section != lastSection) {
        val sum = sums[section]
        out.add(
          ShellHistoryItem.Header(
            section,
            if (sum != null && sum > 0) "+ ${amountFmt.format(sum)} $fcfa" else null,
          ),
        )
        lastSection = section
      }
      out.add(ShellHistoryItem.Row(row))
    }
    if (messages.isNotEmpty()) {
      out.add(ShellHistoryItem.Header(context.getString(R.string.blyp_shell_history_messages)))
      for (row in messages) out.add(ShellHistoryItem.Row(row))
    }
    return out
  }

  private fun isMessageMoney(row: ShellHistoryRow): Boolean {
    val kind = row.kind?.trim().orEmpty()
    if (
      kind == "MONEY_SEND" ||
        kind == "MONEY_CLAIM" ||
        kind == "MONEY_RECALL" ||
        kind == "MONEY_EXPIRE_REFUND"
    ) {
      return true
    }
    val name = row.name.trim()
    return name == "Message Money" || name.startsWith("Message Money")
  }

  private fun loadAllMessageMoney(context: Context, filter: HistoryFilter): List<ShellHistoryRow> {
    val db = openReadOnlyDb(context) ?: return emptyList()
    val typeClause =
      when (filter) {
        HistoryFilter.SENT -> " AND type = 'sent'"
        HistoryFilter.RECEIVED -> " AND type = 'received'"
        HistoryFilter.ALL -> ""
      }
    return try {
      val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
      val amountFmt = NumberFormat.getIntegerInstance(locale)
      db.rawQuery(
          """
          SELECT id, type, amountFcfa, counterpartyName, createdAt, reference, counterpartyPhone, kind
          FROM transactions
          WHERE (
            kind IN ('MONEY_SEND','MONEY_CLAIM','MONEY_RECALL','MONEY_EXPIRE_REFUND')
            OR counterpartyName = 'Message Money'
            OR counterpartyName LIKE 'Message Money (%'
          )$typeClause
          ORDER BY createdAt DESC
          LIMIT ?
          """.trimIndent(),
          arrayOf(LIMIT.toString()),
        )
        .use { it ->
          val out = ArrayList<ShellHistoryRow>()
          while (it.moveToNext()) {
            val id = it.getString(0) ?: continue
            val type = it.getString(1) ?: "sent"
            val amount = it.getInt(2)
            if (amount <= 0) continue
            val name = it.getString(3)?.trim().orEmpty().ifEmpty { "—" }
            val createdAt = it.getString(4)?.trim().orEmpty()
            if (createdAt.isEmpty()) continue
            out.add(
              ShellHistoryRow(
                id = id,
                name = name,
                amountFcfa = amount,
                amountLabel = amountFmt.format(amount),
                dateLabel = formatTimeLabel(createdAt),
                createdAt = createdAt,
                type = type,
                reference = it.getString(5)?.trim()?.ifEmpty { null },
                counterpartyPhone = it.getString(6)?.trim()?.ifEmpty { null },
                kind = it.getString(7)?.trim()?.ifEmpty { null },
              ),
            )
          }
          out
        }
    } catch (_: Exception) {
      emptyList()
    } finally {
      db.close()
    }
  }

  fun insertMessageMoney(
    context: Context,
    phoneRaw: String,
    id: String,
    amountFcfa: Int,
    counterpartyName: String,
  ) {
    val phone = phoneRaw.trim()
    if (phone.isEmpty() || amountFcfa <= 0 || id.isBlank()) return
    val db = openReadWriteDb(context) ?: return
    try {
      db.execSQL(
        """
        INSERT OR REPLACE INTO transactions
          (phone, id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference, kind)
        VALUES (?, ?, 'sent', ?, ?, NULL, ?, ?, 'MONEY_SEND')
        """.trimIndent(),
        arrayOf(
          phone,
          id,
          amountFcfa,
          counterpartyName.trim().ifEmpty { "Message Money" },
          java.time.Instant.now().toString(),
          id,
        ),
      )
    } catch (_: Exception) {
    } finally {
      db.close()
    }
  }

  fun purgeExceptCounterparty(context: Context, keepName: String) {
    val keep = keepName.trim()
    if (keep.isEmpty()) return
    val db = openReadWriteDb(context) ?: return
    try {
      db.execSQL(
        "DELETE FROM transactions WHERE counterpartyName NOT LIKE ?",
        arrayOf("%$keep%"),
      )
    } catch (_: Exception) {
    } finally {
      db.close()
    }
  }

  fun insertSentTransaction(
    context: Context,
    phoneRaw: String,
    id: String,
    amountFcfa: Int,
    counterpartyName: String,
    counterpartyPhone: String?,
    createdAt: String,
    reference: String,
  ) {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadWriteDb(context) ?: return
    try {
      db.execSQL(
        """
        INSERT OR REPLACE INTO transactions
          (phone, id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference, kind)
        VALUES (?, ?, 'sent', ?, ?, ?, ?, ?, 'PAYMENT')
        """.trimIndent(),
        arrayOf(
          phone,
          id,
          amountFcfa,
          counterpartyName,
          counterpartyPhone,
          createdAt,
          reference,
        ),
      )
    } catch (_: Exception) {
    } finally {
      db.close()
    }
  }

  fun deleteTransaction(context: Context, phoneRaw: String, id: String) {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadWriteDb(context) ?: return
    db.use { database ->
      database.execSQL(
        "DELETE FROM transactions WHERE phone = ? AND id = ?",
        arrayOf(phone, id),
      )
    }
  }

  fun insertReceivedTransaction(
    context: Context,
    phoneRaw: String,
    id: String,
    amountFcfa: Int,
    counterpartyName: String,
    counterpartyPhone: String?,
    createdAt: String,
    reference: String?,
  ) {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadWriteDb(context) ?: return
    db.use { database ->
      database.execSQL(
        """
        INSERT OR REPLACE INTO transactions
          (phone, id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference, kind)
        VALUES (?, ?, 'received', ?, ?, ?, ?, ?, 'PAYMENT')
        """.trimIndent(),
        arrayOf(
          phone,
          id,
          amountFcfa,
          counterpartyName,
          counterpartyPhone,
          createdAt,
          reference,
        ),
      )
    }
  }

  fun loadHistory(
    context: Context,
    phoneRaw: String,
    filter: HistoryFilter = HistoryFilter.ALL,
    scoped: Boolean = true,
  ): List<ShellHistoryRow> {
    val phone = if (scoped) scopeKey(context, phoneRaw) else phoneRaw.trim()
    val db = openReadOnlyDb(context) ?: return emptyList()
    val typeClause =
      when (filter) {
        HistoryFilter.SENT -> " AND type = 'sent'"
        HistoryFilter.RECEIVED -> " AND type = 'received'"
        HistoryFilter.ALL -> ""
      }
    return try {
      val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
      val amountFmt = NumberFormat.getIntegerInstance(locale)
      val cursor =
        db.rawQuery(
          """
          SELECT id, type, amountFcfa, counterpartyName, createdAt, reference, counterpartyPhone, kind
          FROM transactions
          WHERE phone = ?$typeClause
          ORDER BY createdAt DESC
          LIMIT ?
          """.trimIndent(),
          arrayOf(phone, LIMIT.toString()),
        )
      cursor.use {
        val out = ArrayList<ShellHistoryRow>()
        while (it.moveToNext()) {
          val id = it.getString(0) ?: continue
          val type = it.getString(1) ?: "sent"
          val amount = it.getInt(2)
          if (amount <= 0) continue
          val name = it.getString(3)?.trim().orEmpty().ifEmpty { "—" }
          val createdAt = it.getString(4)?.trim().orEmpty()
          if (createdAt.isEmpty()) continue
          val reference = it.getString(5)?.trim().orEmpty().ifEmpty { null }
          val counterpartyPhone = it.getString(6)?.trim().orEmpty().ifEmpty { null }
          val kind = it.getString(7)?.trim().orEmpty().ifEmpty { null }
          out.add(
            ShellHistoryRow(
              id = id,
              name = name,
              amountFcfa = amount,
              amountLabel = amountFmt.format(amount),
              dateLabel = formatTimeLabel(createdAt),
              createdAt = createdAt,
              type = type,
              reference = reference,
              counterpartyPhone = counterpartyPhone,
              kind = kind,
            ),
          )
        }
        out
      }
    } catch (_: Exception) {
      emptyList()
    } finally {
      db.close()
    }
  }

  private fun openReadOnlyDb(context: Context): SQLiteDatabase? =
    openDb(context, SQLiteDatabase.OPEN_READONLY)

  fun openReadWriteDb(context: Context): SQLiteDatabase? =
    openDb(context, SQLiteDatabase.OPEN_READWRITE)

  private fun openDb(context: Context, mode: Int): SQLiteDatabase? {
    val file =
      listOf(
        File(context.filesDir, "SQLite/blyp.db"),
        context.getDatabasePath("blyp.db"),
        File(context.filesDir, "blyp.db"),
      ).firstOrNull { it.isFile } ?: File(context.filesDir, "SQLite/blyp.db")
    return try {
      file.parentFile?.mkdirs()
      val db = SQLiteDatabase.openOrCreateDatabase(file, null)
      ensureTxSchema(db)
      if (mode == SQLiteDatabase.OPEN_READONLY) {
        val path = file.absolutePath
        db.close()
        SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY)
      } else {
        db
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun ensureTxSchema(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS transactions (
        phone TEXT NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        amountFcfa INTEGER NOT NULL,
        counterpartyName TEXT NOT NULL,
        counterpartyPhone TEXT,
        createdAt TEXT NOT NULL,
        reference TEXT,
        PRIMARY KEY (phone, id)
      )
      """.trimIndent(),
    )
    db.execSQL(
      "CREATE INDEX IF NOT EXISTS idx_tx_phone_created ON transactions(phone, createdAt DESC)",
    )
    try {
      db.execSQL("ALTER TABLE transactions ADD COLUMN kind TEXT")
    } catch (_: Exception) {
      /* colonne déjà là */
    }
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS sync_meta (
        phone TEXT PRIMARY KEY,
        cursor TEXT
      )
      """.trimIndent(),
    )
  }

  fun readSyncCursor(db: SQLiteDatabase, phone: String): String? {
    db.rawQuery(
      "SELECT cursor FROM sync_meta WHERE phone = ? LIMIT 1",
      arrayOf(phone),
    ).use {
      if (it.moveToFirst()) return it.getString(0)?.trim()?.ifEmpty { null }
    }
    return null
  }

  fun writeSyncCursor(db: SQLiteDatabase, phone: String, cursor: String) {
    db.execSQL(
      "INSERT OR REPLACE INTO sync_meta (phone, cursor) VALUES (?, ?)",
      arrayOf(phone, cursor),
    )
  }

  fun upsertTransactionFromJson(
    db: SQLiteDatabase,
    phone: String,
    o: JSONObject,
  ) {
    var id = o.optString("id").trim()
    if (id.isEmpty()) id = o.optString("reference").trim()
    if (id.isEmpty()) return
    val amount = o.optInt("amountFcfa", 0)
    if (amount <= 0) return
    val createdAt = o.optString("createdAt").trim()
    if (createdAt.isEmpty()) return
    val type = if (o.optString("type") == "received") "received" else "sent"
    val name = o.optString("counterpartyName", "—").trim().ifEmpty { "—" }
    val cpPhone = o.optString("counterpartyPhone").trim().ifEmpty { null }
    val ref = o.optString("reference", "").trim()
    val kindRaw = o.optString("kind").trim()
    val kind = kindRaw.takeIf { it.isNotEmpty() && !it.equals("null", true) }
    if (type == "received") {
      /** Le serveur confirme un encaissement déjà compté en local (Bluetooth) : on ne double pas. */
      db.execSQL(
        """
        DELETE FROM transactions WHERE rowid = (
          SELECT rowid FROM transactions
          WHERE phone = ? AND type = 'received' AND amountFcfa = ? AND id LIKE 'pending-pay-%' AND id != ?
          ORDER BY createdAt ASC LIMIT 1
        )
        """.trimIndent(),
        arrayOf(phone, amount, id),
      )
    }
    db.execSQL(
      """
      INSERT OR REPLACE INTO transactions
        (phone, id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      """.trimIndent(),
      arrayOf(phone, id, type, amount, name, cpPhone, createdAt, ref, kind),
    )
  }

  private fun formatSectionHeader(context: Context, iso: String): String =
    formatWhen(context, iso)

  /** Horodatage serveur (UTC « Z » ou décalage) → heure locale du téléphone. */
  private fun localDateTime(iso: String): java.time.LocalDateTime? {
    val trimmed = iso.trim()
    return try {
      java.time.OffsetDateTime.parse(trimmed)
        .atZoneSameInstant(java.time.ZoneId.systemDefault())
        .toLocalDateTime()
    } catch (_: Exception) {
      try {
        java.time.LocalDateTime.parse(trimmed.take(19))
      } catch (_: Exception) {
        null
      }
    }
  }

  private fun formatTimeLabel(iso: String): String {
    val dt = localDateTime(iso) ?: return iso.trim().take(10)
    return "%02d:%02d".format(dt.hour, dt.minute)
  }

  private fun formatWhen(context: Context, iso: String): String {
    return try {
      val dt =
        localDateTime(iso)?.toLocalDate()
          ?: java.time.LocalDate.parse(iso.trim().take(10))
      val today = java.time.LocalDate.now()
      when {
        dt.isEqual(today) -> context.getString(R.string.blyp_shell_date_today)
        dt.isEqual(today.minusDays(1)) ->
          context.getString(R.string.blyp_shell_date_yesterday)
        else ->
          dt.format(
            java.time.format.DateTimeFormatter.ofPattern(
              "d MMM",
              if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US,
            ),
          )
      }
    } catch (_: Exception) {
      iso.take(10)
    }
  }

  fun sumReceivedForDay(context: Context, phoneRaw: String, dayKey: String): Int {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadOnlyDb(context) ?: return 0
    return try {
      var sum = 0
      val cursor =
        db.rawQuery(
          """
          SELECT amountFcfa, createdAt FROM transactions
          WHERE phone = ? AND type = 'received'
          ORDER BY createdAt DESC
          LIMIT 200
          """.trimIndent(),
          arrayOf(phone),
        )
      cursor.use {
        while (it.moveToNext()) {
          val created = it.getString(1)?.trim().orEmpty()
          if (BlypShellCommerceDay.dayKeyFromIso(created) != dayKey) continue
          sum += it.getInt(0).coerceAtLeast(0)
        }
      }
      sum
    } catch (_: Exception) {
      0
    } finally {
      db.close()
    }
  }

  fun listReceivedForDay(
    context: Context,
    phoneRaw: String,
    dayKey: String,
    max: Int,
  ): List<ShellHistoryRow> {
    val phone = scopeKey(context, phoneRaw)
    val db = openReadOnlyDb(context) ?: return emptyList()
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    return try {
      val cursor =
        db.rawQuery(
          """
          SELECT id, amountFcfa, counterpartyName, createdAt, reference, counterpartyPhone
          FROM transactions
          WHERE phone = ? AND type = 'received'
          ORDER BY createdAt DESC
          LIMIT 80
          """.trimIndent(),
          arrayOf(phone),
        )
      cursor.use {
        val out = ArrayList<ShellHistoryRow>()
        while (it.moveToNext() && out.size < max) {
          val createdAt = it.getString(3)?.trim().orEmpty()
          if (BlypShellCommerceDay.dayKeyFromIso(createdAt) != dayKey) continue
          val amount = it.getInt(1)
          if (amount <= 0) continue
          out.add(
            ShellHistoryRow(
              id = it.getString(0) ?: continue,
              name = it.getString(2)?.trim().orEmpty().ifEmpty { "—" },
              amountFcfa = amount,
              amountLabel = amountFmt.format(amount),
              dateLabel = formatTimeLabel(createdAt),
              createdAt = createdAt,
              type = "received",
              reference = it.getString(4)?.trim()?.ifEmpty { null },
              counterpartyPhone = it.getString(5)?.trim()?.ifEmpty { null },
            ),
          )
        }
        out
      }
    } finally {
      db.close()
    }
  }

  fun counterpartyNameForPhone(
    context: Context,
    ownPhone: String?,
    counterpartyNine: String,
  ): String? {
    val p = ownPhone?.trim().orEmpty()
    val nine = counterpartyNine.replace(Regex("\\D"), "").takeLast(9)
    if (p.isEmpty() || nine.length != 9) return null
    val db = openReadOnlyDb(context) ?: return null
    return try {
      val cursor =
        db.rawQuery(
          """
          SELECT counterpartyName, counterpartyPhone FROM transactions
          WHERE phone = ? AND type = 'sent'
          ORDER BY createdAt DESC
          LIMIT 80
          """.trimIndent(),
          arrayOf(p),
        )
      cursor.use {
        while (it.moveToNext()) {
          val cp =
            it.getString(1)?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty()
          if (cp != nine) continue
          val name = it.getString(0)?.trim().orEmpty()
          if (name.isNotEmpty() && name != "—") return name
        }
        null
      }
    } finally {
      db.close()
    }
  }
}
