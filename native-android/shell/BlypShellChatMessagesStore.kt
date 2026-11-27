package com.haroldndougou.blyp.shell

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ShellChatReaction(
  val emoji: String,
  val userId: String,
)

data class ShellChatBubble(
  val id: String,
  val type: String,
  val body: String,
  val createdAt: String,
  val clientId: String?,
  val senderUserId: String?,
  val mine: Boolean,
  val deletedForAll: Boolean,
  val imageKey: String?,
  val imageThumbKey: String?,
  val imageWidth: Int,
  val imageHeight: Int,
  val replySnippet: String?,
  val replyToId: String?,
  val localImagePath: String?,
  val voiceDurationMs: Int,
  val voiceKey: String?,
  val moneyAmountFcfa: Int,
  val moneyTransferId: String?,
  val moneyStatus: String?,
  val moneyFromUserId: String?,
  val moneyReceiptRequired: Boolean,
  val moneyFruitEmoji: String?,
  val documentKey: String?,
  val documentFileName: String?,
  val documentSizeBytes: Long,
  val documentContentType: String?,
  val documentThumbKey: String?,
  val reactions: List<ShellChatReaction>,
  val outboundPending: Boolean,
  val forwarded: Boolean,
  val voiceLocalPath: String? = null,
  val documentLocalPath: String? = null,
  val moneyClaimedByUserId: String? = null,
  val moneyExpiresAt: String? = null,
  val moneyThanksName: String? = null,
  val imageAlbumId: String? = null,
) {
  fun reactionLine(): String {
    if (reactions.isEmpty()) return ""
    val counts = LinkedHashMap<String, Int>()
    for (r in reactions) {
      val e = r.emoji.trim()
      if (e.isEmpty()) continue
      counts[e] = (counts[e] ?: 0) + 1
    }
    return buildString {
      for ((emoji, n) in counts) {
        if (isNotEmpty()) append(' ')
        append(emoji)
        if (n > 1) append(n)
      }
    }
  }

  fun canMoneyAction(): Boolean {
    if (type != "money" || moneyTransferId.isNullOrEmpty()) return false
    if (moneyStatus != "pending") return false
  return !outboundPending
  }
}

object BlypShellChatMessagesStore {
  private const val MSG_CAP = 80

  fun loadBubbles(
    context: Context,
    phoneRaw: String,
    conversationId: String,
    myUserId: String?,
  ): List<ShellChatBubble> {
    val phone = phoneRaw.trim()
    val cid = conversationId.trim()
    if (phone.isEmpty() || cid.isEmpty()) return emptyList()
    val arr = readJsonArray(context, phone, cid) ?: return emptyList()
    val raw = ArrayList<JSONObject>()
    for (i in 0 until arr.length()) {
      arr.optJSONObject(i)?.let { raw.add(JSONObject(it.toString())) }
    }
    val fixed = absorbDuplicates(raw)
    if (fixed.size != raw.size) {
      saveMerged(context, phone, cid, fixed)
    }
    val bubbles = parseSorted(JSONArray().apply { for (o in fixed) put(o) }, myUserId)
    val kept = bubbles.filter { BlypShellChatModes.keep(context, cid, it.createdAt) }
    val cut = BlypShellChatHistoryWipe.cutoff(context) ?: return kept
    return kept.filter { it.createdAt > cut }
  }

  fun deleteAll(context: Context) {
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return
    try {
      db.execSQL("DELETE FROM chat_messages")
    } catch (_: Exception) {
      /* table absente */
    } finally {
      db.close()
    }
  }

  fun listPendingTexts(context: Context, phoneRaw: String): List<JSONObject> {
    val phone = phoneRaw.trim()
    if (phone.isEmpty()) return emptyList()
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return emptyList()
    val out = ArrayList<JSONObject>()
    return try {
      db.rawQuery(
          "SELECT conversationId, json FROM chat_messages WHERE phone = ?",
          arrayOf(phone),
        )
        .use { c ->
          while (c.moveToNext()) {
            val cid = c.getString(0)?.trim().orEmpty()
            val raw = c.getString(1)?.trim().orEmpty()
            if (cid.isEmpty() || raw.isEmpty()) continue
            val arr = try {
              JSONArray(raw)
            } catch (_: Exception) {
              continue
            }
            for (i in 0 until arr.length()) {
              val o = arr.optJSONObject(i) ?: continue
              val id = o.optString("id").trim()
              val clientId = o.optString("clientId").trim()
              if (id.isEmpty() || id != clientId) continue
              if (o.optString("type") != "text") continue
              if (textOf(o, "body").isEmpty()) continue
              out.add(JSONObject(o.toString()).put("conversationId", cid))
            }
          }
        }
      out
    } catch (_: Exception) {
      emptyList()
    } finally {
      db.close()
    }
  }

  /** Photos, vocaux et documents encore locaux (id = clientId). */
  fun listPendingMedia(context: Context, phoneRaw: String): List<JSONObject> {
    val phone = phoneRaw.trim()
    if (phone.isEmpty()) return emptyList()
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return emptyList()
    val out = ArrayList<JSONObject>()
    return try {
      db.rawQuery(
          "SELECT conversationId, json FROM chat_messages WHERE phone = ?",
          arrayOf(phone),
        )
        .use { c ->
          while (c.moveToNext()) {
            val cid = c.getString(0)?.trim().orEmpty()
            val raw = c.getString(1)?.trim().orEmpty()
            if (cid.isEmpty() || raw.isEmpty()) continue
            val arr =
              try {
                JSONArray(raw)
              } catch (_: Exception) {
                continue
              }
            for (i in 0 until arr.length()) {
              val o = arr.optJSONObject(i) ?: continue
              val id = o.optString("id").trim()
              val clientId = o.optString("clientId").trim()
              if (id.isEmpty() || id != clientId) continue
              val type = o.optString("type")
              if (type != "image" && type != "voice" && type != "document" && type != "money") continue
              out.add(JSONObject(o.toString()).put("conversationId", cid))
            }
          }
        }
      out
    } catch (_: Exception) {
      emptyList()
    } finally {
      db.close()
    }
  }

  fun hasCache(context: Context, phone: String, conversationId: String): Boolean =
    (readJsonArray(context, phone.trim(), conversationId.trim())?.length() ?: 0) > 0

  fun loadRawObjects(
    context: Context,
    phoneRaw: String,
    conversationId: String,
  ): List<JSONObject> {
    val arr = readJsonArray(context, phoneRaw.trim(), conversationId.trim()) ?: return emptyList()
    return buildList {
      for (i in 0 until arr.length()) {
        arr.optJSONObject(i)?.let { add(JSONObject(it.toString())) }
      }
    }
  }

  private val gate = Any()

  fun upsertMessages(
    context: Context,
    phoneRaw: String,
    conversationId: String,
    incoming: List<JSONObject>,
  ): Boolean =
    synchronized(gate) {
      val local = loadRawObjects(context, phoneRaw, conversationId)
      saveMerged(context, phoneRaw, conversationId, mergeNetworkItems(local, incoming))
    }

  fun saveMerged(
    context: Context,
    phoneRaw: String,
    conversationId: String,
    messages: List<JSONObject>,
  ): Boolean {
    val phone = phoneRaw.trim()
    val cid = conversationId.trim()
    if (phone.isEmpty() || cid.isEmpty()) return false
    val sorted = messages.sortedBy { it.optString("createdAt") }
    val cap = sorted.takeLast(MSG_CAP)
    val arr = JSONArray()
    for (o in cap) arr.put(o)
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return false
    return try {
      db.execSQL(
        "INSERT OR REPLACE INTO chat_messages (phone, conversationId, json) VALUES (?, ?, ?)",
        arrayOf(phone, cid, arr.toString()),
      )
      true
    } catch (_: Exception) {
      false
    } finally {
      db.close()
    }
  }

  fun conversationMeta(
    context: Context,
    phone: String,
    conversationId: String,
  ): JSONObject? {
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return null
    return try {
      db.rawQuery(
        "SELECT json FROM conversations WHERE phone = ? AND id = ? LIMIT 1",
        arrayOf(phone.trim(), conversationId.trim()),
      ).use { c ->
        if (!c.moveToFirst()) return null
        JSONObject(c.getString(0).orEmpty())
      }
    } catch (_: Exception) {
      null
    } finally {
      db.close()
    }
  }

  fun parseReactions(arr: JSONArray?): List<ShellChatReaction> {
    if (arr == null) return emptyList()
    val out = ArrayList<ShellChatReaction>()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val emoji = o.optString("emoji").trim()
      val userId = o.optString("userId").trim()
      if (emoji.isNotEmpty() && userId.isNotEmpty()) out.add(ShellChatReaction(emoji, userId))
    }
    return out
  }

  fun patchMessage(
    context: Context,
    phoneRaw: String,
    conversationId: String,
    messageId: String,
    transform: (JSONObject) -> Unit,
  ): Boolean {
    val phone = phoneRaw.trim()
    val cid = conversationId.trim()
    val mid = messageId.trim()
    if (phone.isEmpty() || cid.isEmpty() || mid.isEmpty()) return false
    val arr = readJsonArray(context, phone, cid) ?: return false
    var found = false
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("id").trim() != mid) continue
      transform(o)
      arr.put(i, o)
      found = true
      break
    }
    if (!found) return false
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return false
    return try {
      db.execSQL(
        "INSERT OR REPLACE INTO chat_messages (phone, conversationId, json) VALUES (?, ?, ?)",
        arrayOf(phone, cid, arr.toString()),
      )
      true
    } catch (_: Exception) {
      false
    } finally {
      db.close()
    }
  }

  fun applyDeleteLocal(
    context: Context,
    phone: String,
    conversationId: String,
    messageId: String,
    scope: String,
  ): Boolean {
    val p = phone.trim()
    val cid = conversationId.trim()
    val mid = messageId.trim()
    if (scope == "everyone") {
      val arr = readJsonArray(context, p, cid) ?: return false
      val next = JSONArray()
      var found = false
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (o.optString("id").trim() == mid) {
          found = true
          continue
        }
        next.put(o)
      }
      if (!found) return false
      val db = BlypShellKvCache.openDb(context, writable = true) ?: return false
      return try {
        db.execSQL(
          "INSERT OR REPLACE INTO chat_messages (phone, conversationId, json) VALUES (?, ?, ?)",
          arrayOf(p, cid, next.toString()),
        )
        true
      } catch (_: Exception) {
        false
      } finally {
        db.close()
      }
    }
    val arr = readJsonArray(context, p, cid) ?: return false
    val next = JSONArray()
    var found = false
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("id").trim() == mid) {
        found = true
        continue
      }
      next.put(o)
    }
    if (!found) return false
    val db = BlypShellKvCache.openDb(context, writable = true) ?: return false
    return try {
      db.execSQL(
        "INSERT OR REPLACE INTO chat_messages (phone, conversationId, json) VALUES (?, ?, ?)",
        arrayOf(p, cid, next.toString()),
      )
      true
    } catch (_: Exception) {
      false
    } finally {
      db.close()
    }
  }

  fun applyMoneySignal(context: Context, data: Map<String, String>) {
    val cid = data["conversationId"]?.trim().orEmpty()
    val tid = data["transferId"]?.trim().orEmpty()
    if (cid.isEmpty() || tid.isEmpty()) return
    val phone = BlypShellSession.phone(context)?.trim().orEmpty()
    if (phone.isEmpty()) return
    val transfer = JSONObject().put("transferId", tid)
    val status =
      data["status"]?.trim().orEmpty().ifEmpty {
        if (data["type"] == "money_claimed") "claimed" else ""
      }
    if (status.isNotEmpty()) transfer.put("status", status)
    data["claimedByUserId"]?.trim()?.takeIf { it.isNotEmpty() }?.let {
      transfer.put("claimedByUserId", it)
    }
    data["claimedAt"]?.trim()?.takeIf { it.isNotEmpty() }?.let { transfer.put("claimedAt", it) }
    data["amountFcfa"]?.trim()?.toIntOrNull()?.let { transfer.put("amountFcfa", it) }
    when (data["receiptRequired"]?.trim()) {
      "1", "true" -> transfer.put("receiptRequired", true)
      "0", "false" -> transfer.put("receiptRequired", false)
    }
    patchMoneyTransferById(context, phone, cid, tid, transfer)
    BlypShellChatRealtime.poke(cid)
  }

  fun applyMoneySignal(context: Context, data: JSONObject) {
    val map = HashMap<String, String>()
    val keys = data.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val value = data.opt(key)
      if (value != null && value != JSONObject.NULL) map[key] = value.toString()
    }
    applyMoneySignal(context, map)
  }

  fun patchMoneyTransferById(
    context: Context,
    phone: String,
    conversationId: String,
    transferId: String,
    transfer: JSONObject,
  ): Boolean {
    val tid = transferId.trim()
    if (tid.isEmpty()) return false
    val arr = readJsonArray(context, phone.trim(), conversationId.trim()) ?: return false
  var mid: String? = null
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val tr = o.optJSONObject("moneyTransfer")
      if (tr?.optString("transferId")?.trim() == tid) {
        mid = o.optString("id").trim()
        break
      }
    }
    val messageId = mid ?: return false
    return patchMessage(context, phone, conversationId, messageId) { o ->
      val merged = mergeMoneyTransfer(o.optJSONObject("moneyTransfer"), transfer)
      o.put("moneyTransfer", merged)
    }
  }

  fun patchReactions(
    context: Context,
    phone: String,
    conversationId: String,
    messageId: String,
    reactions: List<ShellChatReaction>,
  ): Boolean {
    return patchMessage(context, phone.trim(), conversationId, messageId) { o ->
      val arr = JSONArray()
      for (r in reactions) {
        arr.put(JSONObject().put("emoji", r.emoji).put("userId", r.userId))
      }
      o.put("reactions", arr)
    }
  }

  fun mergeMoneyTransfer(
    existing: JSONObject?,
    transfer: JSONObject,
  ): JSONObject {
    val base = existing?.let { JSONObject(it.toString()) } ?: JSONObject()
    val tid = transfer.optString("transferId").trim()
    if (tid.isNotEmpty()) base.put("transferId", tid)
    if (transfer.has("amountFcfa")) {
      base.put("amountFcfa", transfer.optInt("amountFcfa", base.optInt("amountFcfa")))
    }
    val status = transfer.optString("status").trim()
    if (status.isNotEmpty()) base.put("status", status)
    val from = transfer.optString("fromUserId").trim()
    if (from.isNotEmpty()) base.put("fromUserId", from)
    if (transfer.has("receiptRequired")) {
      base.put("receiptRequired", transfer.optBoolean("receiptRequired"))
    }
    if (transfer.has("claimedAt")) base.put("claimedAt", transfer.opt("claimedAt"))
    if (transfer.has("claimedByUserId")) base.put("claimedByUserId", transfer.opt("claimedByUserId"))
    return base
  }

  fun isHollow(msg: JSONObject): Boolean {
    return when (cleanToken(msg.optString("type"))) {
      "image" -> msg.optJSONObject("image") == null
      "voice" -> msg.optJSONObject("voice") == null
      "document" -> msg.optJSONObject("document") == null
      "money" ->
        msg.optJSONObject("moneyTransfer") == null && msg.optInt("amountFcfa", 0) <= 0
      else -> false
    }
  }

  fun absorbDuplicates(items: List<JSONObject>): List<JSONObject> {
    val pending = items.filter { isOptimistic(it) }
    val settled = items.filter { !isOptimistic(it) }
    if (pending.isEmpty() || settled.isEmpty()) return items
    return mergeNetworkItems(pending, settled)
  }

  fun mergeNetworkItems(
    local: List<JSONObject>,
    network: List<JSONObject>,
  ): List<JSONObject> {
    val pending = ArrayList<JSONObject>()
    val kept = LinkedHashMap<String, JSONObject>()
    for (o in local) {
      val id = cleanToken(o.optString("id"))
      if (id.isEmpty()) continue
      if (isOptimistic(o)) pending.add(o) else kept[id] = o
    }
    for (inc in network) {
      val id = cleanToken(inc.optString("id"))
      if (id.isEmpty()) continue
      if (inc.optBoolean("deletedForAll", false) || textOf(inc, "deletedForAllAt").isNotEmpty()) {
        pending.removeAll { cleanToken(it.optString("id")) == id }
        kept.remove(id)
        continue
      }
      var cid = cleanToken(inc.optString("clientId"))
      var match =
        if (cid.isNotEmpty()) {
          pending.firstOrNull { cleanToken(it.optString("id")) == cid }
        } else {
          null
        }
      if (match == null && cid.isEmpty()) match = closestPending(pending, inc)
      if (match != null) {
        pending.remove(match)
        cid = cleanToken(match.optString("id")).ifEmpty { cid }
      }
      val merged = mergeMessageFields(match ?: kept[id], inc)
      if (cid.isNotEmpty()) merged.put("clientId", cid)
      if (cid.isNotEmpty()) {
        val dup =
          kept.entries.firstOrNull {
            it.key != id && cleanToken(it.value.optString("clientId")) == cid
          }?.key
        if (dup != null) kept.remove(dup)
      }
      kept[id] = merged
    }
    for (p in pending) {
      val id = cleanToken(p.optString("id"))
      if (id.isNotEmpty() && !kept.containsKey(id)) kept[id] = p
    }
    return kept.values.toList()
  }

  private fun isOptimistic(o: JSONObject): Boolean {
    val id = cleanToken(o.optString("id"))
    val cid = cleanToken(o.optString("clientId"))
    return id.isNotEmpty() && id == cid
  }

  private fun closestPending(pending: List<JSONObject>, incoming: JSONObject): JSONObject? {
    val type = cleanToken(incoming.optString("type"))
    val sender = cleanToken(incoming.optString("senderUserId"))
    val at = cleanToken(incoming.optString("createdAt"))
    var best: JSONObject? = null
    var bestGap = Long.MAX_VALUE
    for (p in pending) {
      if (cleanToken(p.optString("type")) != type) continue
      if (sender.isNotEmpty() && cleanToken(p.optString("senderUserId")) != sender) continue
      val gap = isoGapMs(at, cleanToken(p.optString("createdAt")))
      if (gap in 0..120_000 && gap < bestGap) {
        best = p
        bestGap = gap
      }
    }
    return best
  }

  private fun isoGapMs(a: String, b: String): Long {
    return try {
      kotlin.math.abs(
        java.time.Instant.parse(a).toEpochMilli() - java.time.Instant.parse(b).toEpochMilli(),
      )
    } catch (_: Exception) {
      Long.MAX_VALUE
    }
  }

  private fun mergeMessageFields(local: JSONObject?, incoming: JSONObject): JSONObject {
    if (local == null) return JSONObject(incoming.toString())
    val out = JSONObject(incoming.toString())
    keepObject(local, out, "image")
    keepObject(local, out, "voice")
    keepObject(local, out, "document")
    keepObject(local, out, "moneyTransfer")
    copyLocalPath(local, out, "image")
    val album = cleanToken(local.optString("imageAlbumId"))
    if (album.isNotEmpty() && cleanToken(out.optString("imageAlbumId")).isEmpty()) {
      out.put("imageAlbumId", album)
    }
    copyLocalPath(local, out, "voice")
    copyLocalPath(local, out, "document")
    val body = cleanToken(out.optString("body"))
    val prev = cleanToken(local.optString("body"))
    if (body.isEmpty() && prev.isNotEmpty()) out.put("body", prev)
    return out
  }

  private fun keepObject(local: JSONObject, out: JSONObject, key: String) {
    val inc = out.optJSONObject(key)
    val prev = local.optJSONObject(key)
    if ((inc == null || inc.length() == 0) && prev != null && prev.length() > 0) {
      out.put(key, JSONObject(prev.toString()))
    }
  }

  private fun copyLocalPath(local: JSONObject, out: JSONObject, key: String) {
    val path = cleanToken(local.optJSONObject(key)?.optString("localPath"))
    if (path.isEmpty()) return
    val obj = out.optJSONObject(key) ?: JSONObject().also { out.put(key, it) }
    if (cleanToken(obj.optString("localPath")).isEmpty()) obj.put("localPath", path)
  }

  private fun cleanToken(raw: String?): String {
    val t = raw?.trim().orEmpty()
    return if (t.isEmpty() || t.equals("null", ignoreCase = true)) "" else t
  }

  private fun readJsonArray(
    context: Context,
    phone: String,
    conversationId: String,
  ): JSONArray? {
    if (phone.isEmpty() || conversationId.isEmpty()) return null
    val db = BlypShellKvCache.openDb(context, writable = false) ?: return null
    return try {
      db.rawQuery(
        "SELECT json FROM chat_messages WHERE phone = ? AND conversationId = ? LIMIT 1",
        arrayOf(phone, conversationId),
      ).use { c ->
        if (!c.moveToFirst()) return null
        val raw = c.getString(0)?.trim().orEmpty()
        if (raw.isEmpty()) return null
        JSONArray(raw)
      }
    } catch (_: Exception) {
      null
    } finally {
      db.close()
    }
  }

  private fun parseSorted(arr: JSONArray, myUserId: String?): List<ShellChatBubble> {
    val out = ArrayList<ShellChatBubble>()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optBoolean("deletedForAll", false)) continue
      if (textOf(o, "deletedForAllAt").isNotEmpty()) continue
      bubbleFromJson(o, myUserId)?.let { out.add(it) }
    }
    return out.sortedBy { it.createdAt }
  }

  /** `optString` renvoie le mot « null » quand la valeur JSON est vide. */
  private fun textOf(o: JSONObject?, key: String): String {
    if (o == null || !o.has(key) || o.isNull(key)) return ""
    val t = o.optString(key, "").trim()
    return if (t.equals("null", ignoreCase = true)) "" else t
  }

  fun bubbleFromJson(o: JSONObject, myUserId: String?): ShellChatBubble? {
    val id = o.optString("id").trim()
    if (id.isEmpty()) return null
    val type = o.optString("type", "text").trim().ifEmpty { "text" }
    val clientId = o.optString("clientId").trim().ifEmpty { null }
    val sender = o.optString("senderUserId").trim().ifEmpty { null }
    val deleted = o.optBoolean("deletedForAll", false)
    val createdAt = o.optString("createdAt").trim()
    val mine = BlypShellChatMessageMine.isMine(sender, id, clientId, myUserId)
    val body = if (deleted) "" else textOf(o, "body")
    val image = o.optJSONObject("image")
    val imageKey = textOf(image, "key").ifEmpty { null }
    val imageThumbKey = textOf(image, "thumbKey").ifEmpty { null }
    val imageW = image?.optInt("width", 0) ?: 0
    val imageH = image?.optInt("height", 0) ?: 0
    val reply = o.optJSONObject("replyTo")
    val replyToId =
      reply?.optString("messageId")?.trim().orEmpty().ifEmpty {
        o.optString("replyToMessageId").trim().ifEmpty { null }
      }
    val replySnippet = textOf(reply, "preview").ifEmpty { null }
    val localImagePath =
      textOf(image, "localPath").ifEmpty {
        textOf(image, "localUri")
      }.ifEmpty { null }
    val voice = o.optJSONObject("voice")
    val voiceDurationMs =
      voice?.optInt("durationMs", 0) ?: o.optInt("durationMs", 0)
    val voiceKey = textOf(voice, "key").ifEmpty { null }
    val voiceLocalPath = textOf(voice, "localPath").ifEmpty { null }
    val doc = o.optJSONObject("document")
    val documentKey = textOf(doc, "key").ifEmpty { null }
    val documentFileName = textOf(doc, "fileName").ifEmpty { null }
    val documentSizeBytes = doc?.optLong("sizeBytes", 0L) ?: 0L
    val documentContentType = textOf(doc, "contentType").ifEmpty { null }
    val documentThumbKey = textOf(doc, "thumbKey").ifEmpty { null }
    val documentLocalPath = textOf(doc, "localPath").ifEmpty { null }
    val money = o.optJSONObject("moneyTransfer")
    val moneyAmountFcfa =
      money?.optInt("amountFcfa", 0) ?: o.optInt("amountFcfa", 0)
    val moneyTransferId = textOf(money, "transferId").ifEmpty { null }
    val moneyStatus = textOf(money, "status").ifEmpty { null }
    val moneyFromUserId = textOf(money, "fromUserId").ifEmpty { null }
    val moneyClaimedByUserId = textOf(money, "claimedByUserId").ifEmpty { null }
    val moneyReceiptRequired = money?.optBoolean("receiptRequired", false) == true
    val moneyFruitEmoji = textOf(o, "moneyFruitEmoji").ifEmpty { null }
    val moneyExpiresAt = textOf(money, "expiresAt").ifEmpty { null }
    val moneyThanksName = textOf(money, "thanksFirstName").ifEmpty { null }
    val reactions = parseReactions(o.optJSONArray("reactions"))
    val outboundPending =
      clientId != null && clientId == id && clientId.isNotEmpty()
    val forwarded = o.optBoolean("forwarded", false)
    val imageAlbumId = textOf(o, "imageAlbumId").ifEmpty { null }
    return ShellChatBubble(
      id = id,
      type = type,
      body = body,
      createdAt = createdAt,
      clientId = clientId,
      senderUserId = sender,
      mine = mine,
      deletedForAll = deleted,
      imageKey = imageKey,
      imageThumbKey = imageThumbKey,
      imageWidth = imageW,
      imageHeight = imageH,
      replySnippet = replySnippet,
      replyToId = replyToId,
      localImagePath = localImagePath,
      voiceDurationMs = voiceDurationMs,
      voiceKey = voiceKey,
      moneyAmountFcfa = moneyAmountFcfa,
      moneyTransferId = moneyTransferId,
      moneyStatus = moneyStatus,
      moneyFromUserId = moneyFromUserId,
      moneyReceiptRequired = moneyReceiptRequired,
      moneyFruitEmoji = moneyFruitEmoji,
      documentKey = documentKey,
      documentFileName = documentFileName,
      documentSizeBytes = documentSizeBytes,
      documentContentType = documentContentType,
      documentThumbKey = documentThumbKey,
      reactions = reactions,
      outboundPending = outboundPending,
      forwarded = forwarded,
      voiceLocalPath = voiceLocalPath,
      documentLocalPath = documentLocalPath,
      moneyClaimedByUserId = moneyClaimedByUserId,
      moneyExpiresAt = moneyExpiresAt,
      moneyThanksName = moneyThanksName,
      imageAlbumId = imageAlbumId,
    )
  }

  fun optimisticText(
    conversationId: String,
    myUserId: String,
    body: String,
    clientId: String,
  ): JSONObject =
    JSONObject()
      .put("id", clientId)
      .put("conversationId", conversationId)
      .put("senderUserId", myUserId)
      .put("type", "text")
      .put("body", body)
      .put("createdAt", java.time.Instant.now().toString())
      .put("clientId", clientId)

  fun optimisticImage(
    conversationId: String,
    myUserId: String,
    clientId: String,
    localPath: String,
    width: Int,
    height: Int,
    albumId: String? = null,
  ): JSONObject =
    JSONObject()
      .put("id", clientId)
      .put("conversationId", conversationId)
      .put("senderUserId", myUserId)
      .put("type", "image")
      .put("createdAt", java.time.Instant.now().toString())
      .put("clientId", clientId)
      .apply {
        if (!albumId.isNullOrBlank()) put("imageAlbumId", albumId.trim())
      }
      .put(
        "image",
        JSONObject()
          .put("key", "")
          .put("localPath", localPath)
          .put("width", width)
          .put("height", height),
      )

  fun optimisticVoice(
    conversationId: String,
    myUserId: String,
    clientId: String,
    durationMs: Int,
    localPath: String,
  ): JSONObject =
    JSONObject()
      .put("id", clientId)
      .put("conversationId", conversationId)
      .put("senderUserId", myUserId)
      .put("type", "voice")
      .put("createdAt", java.time.Instant.now().toString())
      .put("clientId", clientId)
      .put(
        "voice",
        JSONObject().put("durationMs", durationMs).put("localPath", localPath),
      )

  fun optimisticMoney(
    conversationId: String,
    myUserId: String,
    clientId: String,
    amountFcfa: Int,
    idempotencyKey: String,
  ): JSONObject =
    JSONObject()
      .put("id", clientId)
      .put("conversationId", conversationId)
      .put("senderUserId", myUserId)
      .put("type", "money")
      .put("createdAt", java.time.Instant.now().toString())
      .put("clientId", clientId)
      .put("moneySendIdempotencyKey", idempotencyKey)
      .put(
        "moneyTransfer",
        JSONObject()
          .put("amountFcfa", amountFcfa)
          .put("status", "pending")
          .put("fromUserId", myUserId),
      )

  fun dropClientMessage(
    context: Context,
    phoneRaw: String,
    conversationId: String,
    clientId: String,
  ): Boolean {
    val id = clientId.trim()
    if (id.isEmpty()) return false
    val kept =
      loadRawObjects(context, phoneRaw, conversationId).filter {
        it.optString("id").trim() != id && it.optString("clientId").trim() != id
      }
    return saveMerged(context, phoneRaw, conversationId, kept)
  }

  fun optimisticDocument(
    conversationId: String,
    myUserId: String,
    clientId: String,
    fileName: String,
    sizeBytes: Long,
    contentType: String,
    localPath: String,
  ): JSONObject =
    JSONObject()
      .put("id", clientId)
      .put("conversationId", conversationId)
      .put("senderUserId", myUserId)
      .put("type", "document")
      .put("createdAt", java.time.Instant.now().toString())
      .put("clientId", clientId)
      .put(
        "document",
        JSONObject()
          .put("fileName", fileName)
          .put("sizeBytes", sizeBytes)
          .put("contentType", contentType)
          .put("localPath", localPath),
      )
}