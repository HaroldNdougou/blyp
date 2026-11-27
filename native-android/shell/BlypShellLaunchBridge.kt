package com.haroldndougou.blyp.shell

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/** Intent extras quand le shell natif ouvre MainActivity (îlot RN). */
object BlypShellLaunchBridge {
  const val EXTRA_RN_ROUTE = "blyp_shell_rn_route"
  const val EXTRA_HIDE_TAB_BAR = "blyp_shell_hide_tab_bar"
  const val EXTRA_RETURN_TO_SHELL = "blyp_shell_return_to_shell"
  const val EXTRA_OPEN_CHAT_ID = "blyp_shell_open_chat_id"
  const val EXTRA_OPEN_CHAT_TRANSFER_ID = "blyp_shell_open_chat_transfer_id"
  const val EXTRA_CHAT_CONVERSATION_ID = "blyp_shell_chat_conversation_id"
  const val EXTRA_CHAT_TRANSFER_ID = "blyp_shell_chat_transfer_id"

  @Volatile private var stagedChatId: String? = null

  @Volatile private var stagedChatTransferId: String? = null

  @Volatile
  private var pendingRoute: String? = null

  @Volatile
  private var pendingHideTabBar: Boolean = false

  @Volatile
  private var pendingReturnToShell: Boolean = false

  private fun intentFor(mainActivityClass: Class<*>): Intent {
    val pkg = mainActivityClass.`package`?.name ?: "com.haroldndougou.blyp"
    return Intent().setClassName(pkg, mainActivityClass.name)
  }

  fun captureFromIntent(intent: Intent?) {
    if (intent == null) return
    if (BlypShellDeepLink.captureChatFromViewIntent(intent)) return
    val openChat = intent.getStringExtra(EXTRA_OPEN_CHAT_ID)?.trim().orEmpty()
    if (openChat.isNotEmpty()) {
      stageChatOpen(
        openChat,
        intent.getStringExtra(EXTRA_OPEN_CHAT_TRANSFER_ID)?.trim()?.ifEmpty { null },
      )
      return
    }
    val route = intent.getStringExtra(EXTRA_RN_ROUTE)?.trim().orEmpty()
    if (route.isEmpty()) return
    if (route == "chat") {
      val conv = intent.getStringExtra(EXTRA_CHAT_CONVERSATION_ID)?.trim().orEmpty()
      if (conv.isNotEmpty()) {
        stageChatOpen(
          conv,
          intent.getStringExtra(EXTRA_CHAT_TRANSFER_ID)?.trim()?.ifEmpty { null },
        )
        return
      }
    }
    pendingRoute = route
    pendingHideTabBar = intent.getBooleanExtra(EXTRA_HIDE_TAB_BAR, route == "messages")
    pendingReturnToShell = intent.getBooleanExtra(EXTRA_RETURN_TO_SHELL, false)
  }

  fun consumeLaunchPayload(): WritableMap? {
    val chat = consumeStagedChat()
    if (chat != null) {
      return Arguments.createMap().apply {
        putString("route", "chat")
        putString("conversationId", chat.first)
        putBoolean("hideTabBar", true)
        putBoolean("returnToShell", true)
        chat.second?.let { putString("transferId", it) }
      }
    }
    val route = pendingRoute ?: return null
    val hide = pendingHideTabBar
    val returnToShell = pendingReturnToShell
    pendingRoute = null
    pendingHideTabBar = false
    pendingReturnToShell = false
    return Arguments.createMap().apply {
      putString("route", route)
      putBoolean("hideTabBar", hide)
      putBoolean("returnToShell", returnToShell)
    }
  }

  fun buildMessagesIslandIntent(mainActivityClass: Class<*>): Intent =
    intentFor(mainActivityClass).apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(EXTRA_RN_ROUTE, "messages")
      putExtra(EXTRA_HIDE_TAB_BAR, true)
      putExtra(EXTRA_RETURN_TO_SHELL, true)
    }

  fun buildNewChatIslandIntent(mainActivityClass: Class<*>): Intent =
    intentFor(mainActivityClass).apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(EXTRA_RN_ROUTE, "new-chat")
      putExtra(EXTRA_HIDE_TAB_BAR, true)
      putExtra(EXTRA_RETURN_TO_SHELL, true)
    }

  fun stageChatOpen(conversationId: String, transferId: String?) {
    stagedChatId = conversationId.trim()
    stagedChatTransferId = transferId?.trim()?.ifEmpty { null }
  }

  fun consumeStagedChat(): Pair<String, String?>? {
    val id = stagedChatId?.trim().orEmpty()
    if (id.isEmpty()) return null
    val transfer = stagedChatTransferId
    stagedChatId = null
    stagedChatTransferId = null
    return id to transfer
  }

  fun buildChatIslandIntent(
    mainActivityClass: Class<*>,
    conversationId: String,
    transferId: String?,
  ): Intent =
    intentFor(mainActivityClass).apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(EXTRA_RN_ROUTE, "chat")
      putExtra(EXTRA_CHAT_CONVERSATION_ID, conversationId.trim())
      putExtra(EXTRA_HIDE_TAB_BAR, true)
      putExtra(EXTRA_RETURN_TO_SHELL, true)
      transferId?.trim()?.takeIf { it.isNotEmpty() }?.let {
        putExtra(EXTRA_CHAT_TRANSFER_ID, it)
      }
    }

  /** Ancienne app complète (dev uniquement), pour cette session seulement. */
  fun buildRnAppIntent(mainActivityClass: Class<*>): Intent =
    intentFor(mainActivityClass).apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(EXTRA_RN_ROUTE, "pay")
      putExtra(EXTRA_HIDE_TAB_BAR, false)
      putExtra(EXTRA_RETURN_TO_SHELL, false)
    }
}
