package com.haroldndougou.blyp.shell

import android.content.Context

/** Précharge les médias du fil en cache (disque + RAM) sans bloquer l’UI. */
object BlypShellChatMediaWarm {
  fun warmThread(context: Context, conversationId: String, rows: List<ShellChatBubble>) {
    val app = context.applicationContext
    val cid = conversationId.trim()
    if (cid.isEmpty() || rows.isEmpty()) return
    Thread {
        for (row in rows.takeLast(24)) {
          when (row.type) {
            "image" -> {
              val key =
                row.imageThumbKey?.trim().orEmpty().ifEmpty {
                  row.imageKey.orEmpty()
                }
              BlypShellChatImageLoader.decodeBest(
                app,
                cid,
                key,
                row.localImagePath,
              )
            }
            "document" -> {
              val thumb = row.documentThumbKey?.trim().orEmpty()
              if (thumb.isNotEmpty()) {
                BlypShellChatImageLoader.decodeBest(app, cid, thumb, null)
              }
            }
          }
        }
      }
      .start()
  }
}