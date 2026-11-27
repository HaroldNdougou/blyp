package com.haroldndougou.blyp.shell

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.UUID

data class ShellMerchantReceiptRow(
  val id: String,
  val name: String,
  val merchantName: String?,
  val category: String,
  val localUri: String,
  val contentType: String,
  val createdAt: String,
)

object BlypMerchantReceiptStore {
  fun list(context: Context, accountId: String): List<ShellMerchantReceiptRow> {
    val id = accountId.trim()
    if (id.isEmpty()) return emptyList()
    val db = openDb(context, readOnly = true) ?: return emptyList()
    return try {
      val out = ArrayList<ShellMerchantReceiptRow>()
      db.rawQuery(
        """
        SELECT id, name, merchantName, category, localUri, contentType, createdAt
        FROM merchant_receipts
        WHERE accountId = ?
        ORDER BY createdAt DESC
        LIMIT 200
        """.trimIndent(),
        arrayOf(id),
      ).use { c ->
        while (c.moveToNext()) {
          out.add(
            ShellMerchantReceiptRow(
              id = c.getString(0),
              name = c.getString(1),
              merchantName = c.getString(2),
              category = c.getString(3),
              localUri = c.getString(4),
              contentType = c.getString(5),
              createdAt = c.getString(6),
            ),
          )
        }
      }
      out
    } catch (_: Exception) {
      emptyList()
    } finally {
      db.close()
    }
  }

  fun addBlypMoney(
    context: Context,
    accountId: String,
    transferId: String,
    name: String,
    merchantName: String?,
    pdfFile: File,
  ): Boolean {
    val acct = accountId.trim()
    val tid = transferId.trim()
    if (acct.isEmpty() || tid.isEmpty() || !pdfFile.isFile) return false
    val id = "blyp-mt-$tid"
    val dir = File(context.filesDir, "blyp-receipts/$acct")
    if (!dir.exists() && !dir.mkdirs()) return false
    val dest = File(dir, "$id.pdf")
    return try {
      if (dest.absolutePath != pdfFile.absolutePath) {
        pdfFile.inputStream().use { input ->
          FileOutputStream(dest).use { out -> input.copyTo(out) }
        }
      }
      val localUri = "file://${dest.absolutePath}"
      val createdAt = Instant.now().toString()
      val db = openDb(context, readOnly = false) ?: return false
      db.use { database ->
        database.execSQL(
          """
          INSERT OR REPLACE INTO merchant_receipts
            (accountId, id, name, merchantName, category, localUri, contentType, sizeBytes, createdAt)
          VALUES (?, ?, ?, ?, 'service', ?, 'application/pdf', ?, ?)
          """.trimIndent(),
          arrayOf(
            acct,
            id,
            name.trim(),
            merchantName?.trim()?.ifEmpty { null },
            localUri,
            dest.length().toInt().coerceAtLeast(1),
            createdAt,
          ),
        )
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  fun hasBlypMoney(context: Context, accountId: String, transferId: String): Boolean {
    val id = "blyp-mt-${transferId.trim()}"
    val acct = accountId.trim()
    if (acct.isEmpty()) return false
    val db = openDb(context, readOnly = true) ?: return false
    return try {
      db.rawQuery(
        "SELECT id FROM merchant_receipts WHERE accountId = ? AND id = ? LIMIT 1",
        arrayOf(acct, id),
      ).use { it.moveToFirst() }
    } catch (_: Exception) {
      false
    } finally {
      db.close()
    }
  }

  fun addManual(
    context: Context,
    accountId: String,
    name: String,
    sourceFile: File,
    contentType: String,
  ): Boolean {
    val acct = accountId.trim()
    if (acct.isEmpty() || !sourceFile.isFile) return false
    val id = UUID.randomUUID().toString()
    val ct = contentType.ifBlank { "image/jpeg" }
    val ext =
      when {
        ct.contains("pdf") -> ".pdf"
        ct.contains("png") -> ".png"
        else -> ".jpg"
      }
    val dir = File(context.filesDir, "blyp-receipts/$acct")
    if (!dir.exists() && !dir.mkdirs()) return false
    val dest = File(dir, "$id$ext")
    return try {
      sourceFile.inputStream().use { input ->
        FileOutputStream(dest).use { out -> input.copyTo(out) }
      }
      val localUri = "file://${dest.absolutePath}"
      val createdAt = Instant.now().toString()
      val db = openDb(context, readOnly = false) ?: return false
      db.use { database ->
        database.execSQL(
          """
          INSERT OR REPLACE INTO merchant_receipts
            (accountId, id, name, merchantName, category, localUri, contentType, sizeBytes, createdAt)
          VALUES (?, ?, ?, NULL, 'manual', ?, ?, ?, ?)
          """.trimIndent(),
          arrayOf(
            acct,
            id,
            name.trim().ifEmpty { "Reçu" },
            localUri,
            ct,
            dest.length().toInt().coerceAtLeast(1),
            createdAt,
          ),
        )
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  fun resolveLocalFile(localUri: String): File? {
    val raw = localUri.trim()
    if (raw.isEmpty()) return null
    val path =
      when {
        raw.startsWith("file://") -> Uri.parse(raw).path
        else -> raw
      }?.trim().orEmpty()
    if (path.isEmpty()) return null
    val f = File(path)
    return f.takeIf { it.isFile && it.canRead() }
  }

  private fun openDb(context: Context, readOnly: Boolean): SQLiteDatabase? {
    val paths =
      listOf(
        File(context.filesDir, "SQLite/blyp.db"),
        context.getDatabasePath("blyp.db"),
        File(context.filesDir, "blyp.db"),
      )
    val mode =
      if (readOnly) SQLiteDatabase.OPEN_READONLY
      else SQLiteDatabase.OPEN_READWRITE
    for (path in paths) {
      if (!path.isFile) continue
      return try {
        SQLiteDatabase.openDatabase(path.absolutePath, null, mode)
      } catch (_: Exception) {
        null
      }
    }
    return null
  }
}
