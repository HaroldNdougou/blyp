package com.haroldndougou.blyp.shell

/** Aligné `lib/messages/messageMine.ts`. */
object BlypShellChatMessageMine {
  fun isMine(
    senderUserId: String?,
    messageId: String,
    clientId: String?,
    myUserId: String?,
  ): Boolean {
    val mine = myUserId?.trim().orEmpty()
    val sender = senderUserId?.trim().orEmpty()
    if (mine.isNotEmpty() && sender == mine) return true
    val cid = clientId?.trim().orEmpty()
    if (cid.isNotEmpty() && messageId == cid) return true
    return false
  }
}