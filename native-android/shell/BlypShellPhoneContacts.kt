package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** Répertoire du téléphone, limité aux numéros camerounais qui ont un compte Blyp. */
object BlypShellPhoneContacts {
  data class Row(
    val name: String,
    val phoneDigits: String,
    val photoUri: String?,
  )

  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private var cacheOwner: String? = null
  private var cache: List<Row>? = null

  private var namesOwner: String? = null
  private var names: Map<String, String>? = null
  private var warmedAt = 0L

  /** Nom enregistré dans le répertoire, jamais le nom légal du compte. */
  fun contactName(context: Context, rawPhone: String?): String? {
    val nine = BlypShellAuthClient.normalizePhoneDigits(rawPhone ?: "") ?: return null
    ensureDisk(context)
    val hit = names?.get(nine)?.trim().orEmpty()
    if (hit.isEmpty() || hit.startsWith("+")) return null
    return hit
  }

  fun labelFor(context: Context, rawPhone: String?, storedName: String?): String {
    contactName(context, rawPhone)?.let { return it }
    val nine = BlypShellAuthClient.normalizePhoneDigits(rawPhone ?: "")
    if (nine != null) return formatPhone(nine)
    val stored = storedName?.trim().orEmpty()
    if (stored.isEmpty() || stored == "?" || stored == "…") return "?"
    return stored
  }

  @Volatile private var warming = false

  fun warmNames(context: Context, onChanged: () -> Unit) {
    val now = System.currentTimeMillis()
    if (names != null && now - warmedAt < 60_000L) return
    if (warming) return
    val app = context.applicationContext
    warming = true
    io.execute {
      try {
        if (!canRead(app)) return@execute
        val owner = ownerNine(app)
        val map = HashMap<String, String>()
        readDisk(app, owner)?.forEach { putName(map, it) }
        readBook(app, owner).forEach { putName(map, it) }
        val prev = names
        warmedAt = System.currentTimeMillis()
        if (prev == map && namesOwner == owner) return@execute
        namesOwner = owner
        names = map
        main.post { onChanged() }
      } finally {
        warming = false
      }
    }
  }

  private fun ensureDisk(context: Context) {
    val owner = ownerNine(context)
    if (names != null && namesOwner == owner) return
    val map = HashMap<String, String>()
    readDisk(context, owner)?.forEach { putName(map, it) }
    namesOwner = owner
    names = map
  }

  private fun putName(map: HashMap<String, String>, row: Row) {
    val name = row.name.trim()
    if (name.isEmpty() || name.startsWith("+")) return
    map[row.phoneDigits] = name
  }

  fun photoUriFor(context: Context, rawPhone: String): String? {
    val nine = BlypShellAuthClient.normalizePhoneDigits(rawPhone) ?: return null
    cached(context)?.firstOrNull { it.phoneDigits == nine }?.photoUri?.let { return it }
    if (!canRead(context)) return null
    val proj =
      arrayOf(
        ContactsContract.CommonDataKinds.Phone.NUMBER,
        ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI,
        ContactsContract.CommonDataKinds.Phone.PHOTO_URI,
      )
    context.contentResolver
      .query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, proj, null, null, null)
      ?.use { c ->
      val iNum = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
      val iThumb = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI)
      val iFull = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.PHOTO_URI)
      while (c.moveToNext()) {
        val n = BlypShellAuthClient.normalizePhoneDigits(if (iNum >= 0) c.getString(iNum) ?: "" else "")
        if (n != nine) continue
        val thumb = if (iThumb >= 0) c.getString(iThumb)?.trim().orEmpty() else ""
        val full = if (iFull >= 0) c.getString(iFull)?.trim().orEmpty() else ""
        val photo = thumb.ifEmpty { full }
        if (photo.isNotEmpty()) return photo
      }
    }
    return null
  }

  fun decodePhoto(context: Context, rawPhone: String): android.graphics.Bitmap? {
    val uri = photoUriFor(context, rawPhone) ?: return null
    return try {
      context.contentResolver.openInputStream(android.net.Uri.parse(uri))?.use { input ->
        android.graphics.BitmapFactory.decodeStream(input)
      }
    } catch (_: Exception) {
      null
    }
  }

  fun cached(context: Context): List<Row>? {
    val owner = ownerNine(context) ?: return null
    if (cacheOwner != owner) return null
    return cache
  }

  fun loadOnBlypAsync(
    context: Context,
    onDone: (rows: List<Row>?, failed: Boolean) -> Unit,
  ) {
    val app = context.applicationContext
    io.execute {
      if (!canRead(app)) {
        main.post { onDone(emptyList(), false) }
        return@execute
      }
      val self = ownerNine(app)
      val saved = readDisk(app, self)
      if (!saved.isNullOrEmpty()) {
        cacheOwner = self
        cache = saved
        main.post { onDone(saved, false) }
      }
      val book = readBook(app, self)
      val byNine = HashMap<String, Row>(book.size)
      for (row in book) byNine[row.phoneDigits] = row
      val found = LinkedHashSet<String>()
      val onBlyp =
        BlypShellContactsClient.phonesOnBlyp(app, book.map { it.phoneDigits }) { partial ->
          val snapshot =
            synchronized(found) {
              if (!found.addAll(partial)) return@phonesOnBlyp
              HashSet(found)
            }
          val rows = rowsFor(snapshot, byNine)
          cacheOwner = self
          cache = rows
          main.post { onDone(rows, false) }
        }
      if (onBlyp == null) {
        if (saved == null) main.post { onDone(null, true) }
        return@execute
      }
      val rows = rowsFor(onBlyp, byNine)
      cacheOwner = self
      cache = rows
      writeDisk(app, self, rows)
      main.post { onDone(rows, false) }
    }
  }

  private fun rowsFor(phones: Set<String>, byNine: Map<String, Row>): List<Row> =
    phones.mapNotNull { byNine[it] }.sortedBy { it.name.lowercase() }

  private fun canRead(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
      PackageManager.PERMISSION_GRANTED

  private fun ownerNine(context: Context): String? =
    BlypShellAuthClient.normalizePhoneDigits(BlypShellSession.phone(context).orEmpty())

  private fun readBook(context: Context, excludeNine: String?): List<Row> {
    val byNine = LinkedHashMap<String, Row>()
    val proj =
      arrayOf(
        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
        ContactsContract.CommonDataKinds.Phone.NUMBER,
        ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI,
      )
    context.contentResolver
      .query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, proj, null, null, null)
      ?.use { c ->
      val iName = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
      val iNum = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
      val iPhoto = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI)
      while (c.moveToNext()) {
        val raw = if (iNum >= 0) c.getString(iNum) else null
        val nine = BlypShellAuthClient.normalizePhoneDigits(raw ?: "") ?: continue
        if (nine == excludeNine) continue
        val name = (if (iName >= 0) c.getString(iName) else null)?.trim().orEmpty()
        val photo = if (iPhoto >= 0) c.getString(iPhoto)?.trim()?.ifEmpty { null } else null
        val existing = byNine[nine]
        val nextName =
          when {
            name.isNotBlank() && (existing == null || name.length >= existing.name.length) -> name
            existing != null && existing.name.isNotBlank() -> existing.name
            else -> formatPhone(nine)
          }
        val nextPhoto = photo ?: existing?.photoUri
        if (existing == null || nextName != existing.name || nextPhoto != existing.photoUri) {
          byNine[nine] = Row(nextName, nine, nextPhoto)
        }
      }
    }
    return byNine.values.sortedBy { it.name.lowercase() }
  }

  private fun formatPhone(nine: String): String =
    "+237 ${nine.take(3)} ${nine.drop(3).take(3)} ${nine.drop(6)}"

  private fun cacheFile(context: Context, owner: String?): File =
    File(context.filesDir, "blyp-onblyp-${owner ?: "none"}.json")

  private fun readDisk(context: Context, owner: String?): List<Row>? {
    val file = cacheFile(context, owner)
    if (!file.isFile) return null
    return try {
      val arr = JSONObject(file.readText()).optJSONArray("rows") ?: return null
      val out = ArrayList<Row>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val nine = o.optString("p")
        if (nine.length != 9) continue
        out.add(
          Row(
            name = o.optString("n").ifBlank { formatPhone(nine) },
            phoneDigits = nine,
            photoUri = o.optString("u").trim().ifEmpty { null },
          ),
        )
      }
      out
    } catch (_: Exception) {
      null
    }
  }

  private fun writeDisk(context: Context, owner: String?, rows: List<Row>) {
    val arr = JSONArray()
    for (row in rows) {
      arr.put(
        JSONObject()
          .put("n", row.name)
          .put("p", row.phoneDigits)
          .put("u", row.photoUri ?: ""),
      )
    }
    try {
      cacheFile(context, owner).writeText(JSONObject().put("rows", arr).toString())
    } catch (_: Exception) {
    }
  }
}
