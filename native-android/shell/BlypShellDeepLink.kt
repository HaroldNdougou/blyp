package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.net.Uri

object BlypShellDeepLink {
  fun pendingIntentActivity(
    context: Context,
    conversationId: String,
    transferId: String? = null,
  ): Intent {
    val app = context.applicationContext
    if (BlypShellEntry.isNativeShellLauncher(app)) {
      return Intent(app, BlypNativeShellActivity::class.java).apply {
        addFlags(
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_NEW_TASK,
        )
        putExtra(BlypShellLaunchBridge.EXTRA_OPEN_CHAT_ID, conversationId.trim())
        transferId?.trim()?.takeIf { it.isNotEmpty() }?.let {
          putExtra(BlypShellLaunchBridge.EXTRA_OPEN_CHAT_TRANSFER_ID, it)
        }
      }
    }
    val uri =
      Uri.parse("blyp://chat/${Uri.encode(conversationId.trim())}").let { base ->
        transferId?.trim()?.takeIf { it.isNotEmpty() }?.let { tid ->
          base.buildUpon().appendQueryParameter("transferId", tid).build()
        } ?: base
      }
    return Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(app.packageName)
      addFlags(
        Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_NEW_TASK,
      )
    }
  }

  fun captureChatFromViewIntent(intent: Intent?): Boolean {
    val data = intent?.data ?: return false
    if (data.scheme != "blyp") return false
    if (data.host != "chat") return false
    val segments = data.pathSegments
    val conversationId = segments.firstOrNull()?.trim().orEmpty()
    if (conversationId.isEmpty()) return false
    val transferId = data.getQueryParameter("transferId")?.trim().orEmpty()
    BlypShellLaunchBridge.stageChatOpen(conversationId, transferId.ifEmpty { null })
    return true
  }

  fun openMessagesIslandForChat(context: Context, mainActivityClass: Class<*>) {
    BlypShellLaunchBridge.consumeStagedChat()
  }
}
