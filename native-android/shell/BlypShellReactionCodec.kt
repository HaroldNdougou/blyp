package com.haroldndougou.blyp.shell

import org.json.JSONArray
import org.json.JSONObject

/** Réactions rapides — sync texte plié comme les positions. */
object BlypShellReactionCodec {
  val QUICK = arrayOf("👍", "❤️", "😂", "😮", "😢", "🙏")
  private val ALLOWED = QUICK.toSet()
  private val PREFIXES = arrayOf("BLYP_R|", "\u200B\u200BR|")

  fun encode(messageId: String, emoji: String): String =
    "BLYP_R|${messageId.trim()}|${emoji.trim()}"

  fun parse(body: String?): Pair<String, String>? {
    val raw = body?.trim().orEmpty()
    var rest = ""
    for (p in PREFIXES) {
      if (raw.startsWith(p)) {
        rest = raw.removePrefix(p)
        break
      }
    }
    if (rest.isEmpty()) return null
    val sep = rest.lastIndexOf('|')
    if (sep < 0) return null
    val messageId = rest.substring(0, sep).trim()
    val emoji = rest.substring(sep + 1).trim()
    if (messageId.isEmpty()) return null
    if (emoji.isNotEmpty() && emoji !in ALLOWED) return null
    return messageId to emoji
  }

  fun isSyncBody(body: String?): Boolean = parse(body) != null

  fun foldRaw(items: List<JSONObject>): List<JSONObject> {
    if (items.isEmpty()) return items
    val syncs = ArrayList<Sync>()
    val visible = ArrayList<JSONObject>(items.size)
    for (o in items) {
      val body = o.optString("body", "")
      val parsed = parse(body)
      val sender = o.optString("senderUserId", "").trim()
      val type = o.optString("type", "text").trim().ifEmpty { "text" }
      // Jamais une bulle « Message » : sync réaction pliée quel que soit le type
      if ((parsed != null || type.equals("reaction", ignoreCase = true)) && sender.isNotEmpty()) {
        if (parsed != null) {
          syncs.add(
            Sync(
              messageId = parsed.first,
              emoji = parsed.second,
              userId = sender,
              createdAt = o.optString("createdAt", ""),
            ),
          )
        }
        continue
      }
      visible.add(o)
    }
    if (syncs.isEmpty()) return visible
    syncs.sortBy { it.createdAt }
    val byId = HashMap<String, JSONObject>()
    for (o in visible) {
      val id = o.optString("id", "").trim()
      if (id.isNotEmpty()) byId[id] = o
    }
    for (s in syncs) {
      val target = byId[s.messageId] ?: continue
      val next = applyUserReaction(parseReactions(target.optJSONArray("reactions")), s.userId, s.emoji)
      val copy = JSONObject(target.toString())
      val arr = JSONArray()
      for (r in next) {
        arr.put(JSONObject().put("emoji", r.emoji).put("userId", r.userId))
      }
      copy.put("reactions", arr)
      byId[s.messageId] = copy
      val idx = visible.indexOfFirst { it.optString("id") == s.messageId }
      if (idx >= 0) visible[idx] = copy
    }
    return visible
  }

  fun foldArray(arr: JSONArray): JSONArray {
    val list = ArrayList<JSONObject>(arr.length())
    for (i in 0 until arr.length()) {
      arr.optJSONObject(i)?.let { list.add(it) }
    }
    val folded = foldRaw(list)
    return JSONArray().apply { for (o in folded) put(o) }
  }

  fun applyUserReaction(
    reactions: List<ShellChatReaction>,
    userId: String,
    emoji: String,
  ): List<ShellChatReaction> {
    val rest = reactions.filter { it.userId != userId }
    val e = emoji.trim()
    if (e.isEmpty()) return rest
    return rest + ShellChatReaction(e, userId)
  }

  fun parseReactions(arr: JSONArray?): List<ShellChatReaction> {
    if (arr == null) return emptyList()
    val out = ArrayList<ShellChatReaction>()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val emoji = o.optString("emoji", "").trim()
      val userId = o.optString("userId", "").trim()
      if (emoji.isNotEmpty() && userId.isNotEmpty()) out.add(ShellChatReaction(emoji, userId))
    }
    return out
  }

  fun listPreview(emoji: String, mine: Boolean, reactorFirstName: String = ""): String {
    val e = emoji.trim()
    if (e.isEmpty()) return ""
    return if (mine) "*\t$e" else "${reactorFirstName.trim()}\t$e"
  }

  private data class Sync(
    val messageId: String,
    val emoji: String,
    val userId: String,
    val createdAt: String,
  )
}
