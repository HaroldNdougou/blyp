package com.haroldndougou.blyp.shell

import android.Manifest
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.Uri
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.graphics.Outline
import android.view.ViewOutlineProvider
import android.text.Editable
import android.text.TextWatcher
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.paymentannounce.PaymentAnnouncePrefs
import java.io.File
import java.util.UUID

class ShellChatThreadActivity : BlypShellActivity() {
  private lateinit var conversationId: String
  private var peerName: String = "…"
  private var peerPhone: String = ""
  private val shownMeta = HashSet<String>()
  private val sentFlashUntil = HashMap<String, Long>()

  fun sentFlashOn(id: String): Boolean {
    val until = sentFlashUntil[id] ?: return false
    if (System.currentTimeMillis() > until) {
      sentFlashUntil.remove(id)
      return false
    }
    return true
  }

  private fun markSentFlash(ids: Collection<String>) {
    if (ids.isEmpty()) return
    val until = System.currentTimeMillis() + 3_000L
    for (id in ids) sentFlashUntil[id] = until
    window.decorView.postDelayed(
      {
        if (isFinishing || !::adapter.isInitialized) return@postDelayed
        val now = System.currentTimeMillis()
        val expired = sentFlashUntil.filter { it.value <= now }.keys.toList()
        for (id in expired) sentFlashUntil.remove(id)
        expired.forEach { adapter.refresh(it) }
      },
      3_100L,
    )
  }

  fun toggleMeta(id: String) {
    if (!shownMeta.add(id)) shownMeta.remove(id)
    if (::adapter.isInitialized) adapter.refresh(id)
  }

  fun isMetaShown(id: String): Boolean = id in shownMeta

  fun collapseMeta() {
    val chrome = reactChromeId
    reactChromeId = null
    if (shownMeta.isEmpty() && chrome == null) return
    val ids = (shownMeta.toList() + listOfNotNull(chrome)).distinct()
    shownMeta.clear()
    if (::adapter.isInitialized) {
      for (id in ids) adapter.refresh(id)
    }
  }

  private var chatVisible = false
  private val seenBubbleIds = HashSet<String>()
  private var seenPrimed = false
  private var glideUntil = 0L
  private var voiceMode = 0
  private var voiceSending = false
  private var voicePreview: File? = null
  private var voicePreviewMs = 0
  private var voiceStartedAt = 0L
  private var voiceScrubbing = false
  private var voiceFingerDown = false
  private var voiceLocked = false
  private var voiceCancelArmed = false
  private var voiceDownX = 0f
  private var voiceDownY = 0f
  private var voiceEffect = "none"
  private var voiceRaw: File? = null
  private var chatSynced = false
  private var sendSpinId: String? = null
  private var celebrateTransferId: String? = null
  private val moneySettleIds = HashSet<String>()
  private val voiceTicker =
    object : Runnable {
      override fun run() {
        if (voiceMode != 1) return
        val ms = (System.currentTimeMillis() - voiceStartedAt).coerceAtLeast(0L)
        findViewById<TextView>(R.id.blyp_chat_voice_clock)?.text = voiceClock(ms)
        val dot = findViewById<View>(R.id.blyp_chat_voice_dot)
        dot?.alpha = if ((ms / 500L) % 2L == 0L) 1f else 0.35f
        paintVoiceWave(recording = true)
        window.decorView.postDelayed(this, 120)
      }
    }
  private var peerReadAt: String? = null
  private var localReadAt: String? = null
  private lateinit var listView: RecyclerView
  private lateinit var input: EditText
  private lateinit var replyBar: LinearLayout
  private lateinit var replyText: TextView
  private var cached: List<ShellChatBubble> = emptyList()
  private var sending = false
  private var replyToId: String? = null
  private var replyPreview: String? = null
  private var unsubRealtime: (() -> Unit)? = null
  private var unsubReceipts: (() -> Unit)? = null
  private var voiceUnsub: (() -> Unit)? = null
  private lateinit var adapter: ChatAdapter
  private var claimingTransferId: String? = null
  private var arrivalKeyboardDone = false
  private var pendingStamp: String = ""
  private val dayHide =
    Runnable {
      val day = findViewById<TextView>(R.id.blyp_chat_day)
      day.animate().cancel()
      day.animate().alpha(0f).setDuration(180L).withEndAction {
        if (isDestroyed) return@withEndAction
        day.visibility = View.GONE
        day.alpha = 1f
      }
    }
  private val onlineRecheck = Runnable { paintOnline() }
  private val lastSeenShow = Runnable { showLastSeen() }
  private val lastSeenHide = Runnable { hideLastSeen() }
  private val vanishSweep = Runnable { sweepVanish() }
  private val requestLocation =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) pickPlaceMode() else toast(getString(R.string.blyp_shell_chat_place_denied))
    }
  private var unsubChat: (() -> Unit)? = null
  private val presencePulse =
    object : Runnable {
      override fun run() {
        if (!chatVisible || isFinishing) return
        BlypShellChatReceipts.markPresenceAsync(this@ShellChatThreadActivity, conversationId)
        window.decorView.postDelayed(this, 20_000L)
      }
    }

  private val pendingPhotos = mutableListOf<File>()
  private var cameraFile: File? = null
  private var toolLit = 0
  private var morePopup: android.widget.PopupWindow? = null
  private var reactPopup: android.widget.PopupWindow? = null
  private var reactFanOverlay: ViewGroup? = null
  private var reactFanBubble: View? = null
  private var reactChromeId: String? = null
  private var reactBounceId: String? = null
  private var reactRemoveId: String? = null
  private var reactPushedViews: List<View> = emptyList()
  private var reactPressedRow: View? = null
  private var reactGapAnim: android.animation.ValueAnimator? = null
  private var reactGapSavedTop = 0
  private var reactChromeKeep = false

  private fun dismissReactFan() {
    val overlay = reactFanOverlay
    reactFanOverlay = null
    val b = reactFanBubble
    reactFanBubble = null
    if (overlay != null) (overlay.parent as? ViewGroup)?.removeView(overlay)
    b?.animate()?.scaleX(1f)?.scaleY(1f)?.setDuration(100)?.start()
    releaseReactPush(animate = true)
    if (!reactChromeKeep) clearReactChrome()
    reactChromeKeep = false
    reactPopup?.dismiss()
    reactPopup = null
  }

  fun isReactChrome(id: String): Boolean = reactChromeId == id

  fun takeReactBounce(id: String): Boolean {
    if (reactBounceId != id) return false
    reactBounceId = null
    return true
  }

  fun takeReactRemove(id: String): Boolean {
    if (reactRemoveId != id) return false
    reactRemoveId = null
    return true
  }

  private fun armReactChrome(id: String) {
    val prev = reactChromeId
    reactChromeId = id
    shownMeta.add(id)
    if (::adapter.isInitialized) {
      if (prev != null && prev != id) adapter.refresh(prev)
      adapter.refresh(id)
    }
  }

  private fun clearReactChrome() {
    val id = reactChromeId ?: return
    reactChromeId = null
    shownMeta.remove(id)
    if (::adapter.isInitialized) adapter.refresh(id)
  }

  private fun rowForBubble(bubble: View): View? {
    var v: View? = bubble
    while (v != null) {
      val p = v.parent
      if (p === listView) return v
      v = p as? View
    }
    return null
  }

  private fun pushNeighborsAbove(bubble: View, amountPx: Float) {
    releaseReactPush(animate = false)
    if (!::listView.isInitialized || amountPx <= 0f) return
    val row = rowForBubble(bubble) ?: return
    reactPressedRow = row
    val bLoc = IntArray(2)
    bubble.getLocationOnScreen(bLoc)
    val bubbleTop = bLoc[1]
    val nudged = ArrayList<View>()
    for (i in 0 until listView.childCount) {
      val child = listView.getChildAt(i) ?: continue
      if (child === row) continue
      val cLoc = IntArray(2)
      child.getLocationOnScreen(cLoc)
      if (cLoc[1] + child.height <= bubbleTop + 12) {
        nudged.add(child)
        child.animate().cancel()
        child.translationY = 0f
        child
          .animate()
          .translationY(-amountPx)
          .setDuration(180)
          .setInterpolator(android.view.animation.DecelerateInterpolator())
          .start()
      }
    }
    row.animate().cancel()
    row.translationY = 0f
    row
      .animate()
      .translationY(amountPx * 0.25f)
      .setDuration(180)
      .setInterpolator(android.view.animation.DecelerateInterpolator())
      .start()
    reactPushedViews = nudged
  }

  private fun releaseReactPush(animate: Boolean = true) {
    reactGapAnim?.cancel()
    reactGapAnim = null
    val row = reactPressedRow
    reactPressedRow = null
    val all = reactPushedViews + listOfNotNull(row)
    for (v in all) {
      if (animate) {
        v
          .animate()
          .translationY(0f)
          .setDuration(160)
          .setInterpolator(android.view.animation.DecelerateInterpolator())
          .start()
      } else {
        v.animate().cancel()
        v.translationY = 0f
      }
    }
    reactPushedViews = emptyList()
  }
  private var typingUnsub: (() -> Unit)? = null
  private var nearbyUnsub: (() -> Unit)? = null
  private var typingSentOn = false
  private var typingPulseAt = 0L
  private val typingIdle = Runnable { sendTyping(false) }

  private val pickImages =
    registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
      if (uris.isEmpty()) return@registerForActivityResult
      val files = uris.mapNotNull { BlypShellPhotoPick.copyToCache(applicationContext, it) }
      if (files.isEmpty()) toast(getString(R.string.blyp_shell_chat_send_failed)) else stagePhotos(files)
    }

  private val takePicture =
    registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
      val file = cameraFile
      cameraFile = null
      if (ok && file != null && file.exists()) stagePhotos(listOf(file))
    }

  private val cameraPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) launchCamera() else toast(getString(R.string.blyp_shell_chat_camera_denied))
    }

  private val requestMic =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (!granted) toast(getString(R.string.blyp_shell_chat_mic_denied))
    }

  private val moneyResult =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
      if (it.resultCode == RESULT_OK) bindFromCache(scrollEnd = true)
    }

  private val receiptClaimResult =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
      if (it.resultCode == RESULT_OK) {
        val id = it.data?.getStringExtra(ShellChatMoneyReceiptActivity.EXTRA_TRANSFER_ID)
        if (!id.isNullOrBlank()) celebrateTransferId = id
        bindFromCache(scrollEnd = false)
      }
    }

  private val forwardResult =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { /* ok */ }

  private val pickDocument =
    registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
      if (uri == null) return@registerForActivityResult
      val picked = BlypShellDocumentPick.copyToCache(this, uri) ?: run {
        toast(getString(R.string.blyp_shell_chat_doc_failed))
        return@registerForActivityResult
      }
      sendPickedDocument(picked)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    conversationId = intent.getStringExtra(EXTRA_CONVERSATION_ID)?.trim().orEmpty()
    if (conversationId.isEmpty() || !BlypShellSession.hasValidSession(this)) {
      finish()
      return
    }
    setContentView(R.layout.blyp_shell_chat_thread)
    hugDayChip()
    applySystemBarAppearance()
    val root = findViewById<View>(R.id.blyp_chat_root)
    watchKeyboard(root)
    peerPhone = intent.getStringExtra(EXTRA_PEER_PHONE)?.trim().orEmpty()
    if (peerPhone.isEmpty()) {
      peerPhone =
        BlypShellChatMessagesStore.conversationMeta(this, phone(), conversationId)
          ?.optString("peerPhone")
          ?.trim()
          .orEmpty()
    }
    val incomingName =
      intent.getStringExtra(EXTRA_PEER_NAME)?.trim().orEmpty().ifEmpty { loadPeerName() }
    peerName = BlypShellPhoneContacts.labelFor(this, peerPhone, incomingName)
    findViewById<TextView>(R.id.blyp_chat_title).text = peerName
    BlypShellPhoneContacts.warmNames(this) {
      val next = BlypShellPhoneContacts.labelFor(this, peerPhone, peerName)
      if (next == peerName || isFinishing) return@warmNames
      peerName = next
      findViewById<TextView>(R.id.blyp_chat_title).text = next
    }
    findViewById<View>(R.id.blyp_chat_back).setOnClickListener { finish() }
    bindPeerAvatar()
    BlypShellConversationsStore.touchOpened(
      this,
      phone(),
      conversationId,
      peerName,
      peerPhone.ifEmpty { null },
    )
    listView = findViewById(R.id.blyp_chat_list)
    listView.clipChildren = false
    listView.clipToPadding = false
    input = findViewById(R.id.blyp_chat_input)
    input.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          paintSend()
          pulseTyping()
          scheduleDraftTextSave()
        }
      },
    )
    restoreComposerDraft()
    paintSend()
    paintTools()
    replyBar = findViewById(R.id.blyp_chat_reply_bar)
    replyText = findViewById(R.id.blyp_chat_reply_text)
    findViewById<TextView>(R.id.blyp_chat_reply_cancel).setOnClickListener {
      clearReply()
    }
    adapter =
      ChatAdapter(
        conversationId = conversationId,
        onToast = ::toast,
        onLongPress = { row, anchor -> onMessageLongPress(row, anchor) },
        onMoneyAction = ::onMoneyAction,
        onReceiptToggle = ::onMoneyReceiptToggle,
        claimingTransferId = { claimingTransferId },
      )
    voiceUnsub =
      BlypShellChatVoicePlayer.subscribe { _, _ ->
        runOnUiThread { adapter.notifyPlaybackChanged() }
      }
    listView.layoutManager =
      LinearLayoutManager(this).apply {
        stackFromEnd = true
      }
    listView.adapter = adapter
    listView.itemAnimator =
      androidx.recyclerview.widget.DefaultItemAnimator().apply {
        supportsChangeAnimations = false
        removeDuration = 200L
        moveDuration = 240L
        changeDuration = 0L
      }
    listView.addOnScrollListener(
      object : RecyclerView.OnScrollListener() {
        override fun onScrollStateChanged(rv: RecyclerView, newState: Int) {
          if (newState == RecyclerView.SCROLL_STATE_IDLE) scheduleDayHide() else showDayChip()
        }

        override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) {
          if (dy != 0) showDayChip()
          paintJump()
        }
      },
    )
    findViewById<View>(R.id.blyp_chat_jump).setOnClickListener { jumpToLatest() }
    findViewById<View>(R.id.blyp_chat_send_hit).setOnClickListener {
      when {
        voiceMode == 2 -> sendVoicePreview()
        pendingPhotos.isNotEmpty() -> sendPendingPhotos()
        else -> sendText()
      }
      jumpToLatest()
    }
    findViewById<View>(R.id.blyp_chat_more).setOnClickListener { openMore() }
    findViewById<View>(R.id.blyp_chat_money).setOnClickListener {
      lightTool(0)
      moneyResult.launch(
        Intent(this, ShellChatMoneyActivity::class.java).apply {
          putExtra(ShellChatMoneyActivity.EXTRA_CONVERSATION_ID, conversationId)
        },
      )
    }
    findViewById<View>(R.id.blyp_chat_nearby).setOnClickListener { openChatPaySheet() }
    findViewById<View>(R.id.blyp_chat_mic).setOnClickListener {
      if (voiceMode != 0) return@setOnClickListener
      if (
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
          PackageManager.PERMISSION_GRANTED
      ) {
        requestMic.launch(Manifest.permission.RECORD_AUDIO)
        return@setOnClickListener
      }
      beginVoiceRecording()
    }
    findViewById<View>(R.id.blyp_chat_emoji).setOnClickListener { toggleEmoji() }
    findViewById<TextView>(R.id.blyp_chat_voice_delete).setOnClickListener { discardVoice() }
    findViewById<View>(R.id.blyp_chat_voice_action).setOnClickListener {
      if (voiceMode == 1) pauseVoiceForPreview() else onVoiceTransport()
    }
    findViewById<View>(R.id.blyp_chat_voice_resume).setOnClickListener { continueVoice() }
    findViewById<View>(R.id.blyp_chat_voice_send).setOnClickListener { finishAndSendVoice() }
    listView.setOnTouchListener { _, event ->
      if (event.action == MotionEvent.ACTION_DOWN) {
        closeEmoji()
        if (toolLit != 0) lightTool(0)
      }
      false
    }
    input.setOnClickListener { if (toolLit != 0) lightTool(0) }
    BlypShellClicks.arm(window.decorView)
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val panel = findViewById<View>(R.id.blyp_chat_emoji_panel)
          if (panel?.visibility == View.VISIBLE) {
            closeEmoji()
          } else {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
          }
        }
      },
    )
    BlypShellPerfMarks.start("chat_open")
    bindFromCache(scrollEnd = true)
    BlypShellPerfMarks.end("chat_open")
    window.decorView.post {
      BlypShellChatThreadSync.scheduleAfterPaint(applicationContext, phone(), conversationId) {
        if (isFinishing) return@scheduleAfterPaint
        chatSynced = true
        bindFromCache(scrollEnd = cached.isEmpty())
      }
    }
  }

  override fun onStart() {
    super.onStart()
    unsubRealtime =
      BlypShellChatRealtime.subscribeThread { convId ->
        if (convId != conversationId || isFinishing) return@subscribeThread
        bindFromCache(scrollEnd = true)
      }
    unsubChat =
      BlypShellUiRefresh.subscribeChat { convId ->
        if (convId != conversationId || isFinishing) return@subscribeChat
        bindFromCache(scrollEnd = false)
      }
    unsubReceipts =
      BlypShellChatReceipts.subscribe { convId ->
        if (convId != conversationId || isFinishing) return@subscribe
        paintOnline()
        bindFromCache(scrollEnd = false)
      }
    typingUnsub =
      BlypShellChatTyping.subscribe { convId ->
        if (convId != conversationId || isFinishing) return@subscribe
        paintTyping()
      }
    paintTyping()
    BlypShellNearbyScan.startForChat(this)
    nearbyUnsub =
      BlypShellNearbyScan.subscribe { peer ->
        runOnUiThread { if (!isFinishing) paintNearbyMerchant(peer) }
      }
    BlypShellChatVoicePlayer.setComposerProgress { id, pos, dur, playing, _ ->
      if (id != "voice-preview" || isFinishing) return@setComposerProgress
      runOnUiThread {
        paintVoiceTransport()
        if (voiceScrubbing || voiceMode == 1) return@runOnUiThread
        val wave = findViewById<BlypShellVoiceWaveView>(R.id.blyp_chat_voice_wave)
        val span = if (dur > 0) dur else voicePreviewMs
        wave?.setFraction(if (span > 0) pos.toFloat() / span else 0f, true)
        findViewById<TextView>(R.id.blyp_chat_voice_clock)?.text =
          voiceClock((if (playing) pos else voicePreviewMs).toLong())
      }
    }
  }

  override fun onStop() {
    unsubRealtime?.invoke()
    unsubRealtime = null
    unsubReceipts?.invoke()
    unsubReceipts = null
    unsubChat?.invoke()
    unsubChat = null
    typingUnsub?.invoke()
    typingUnsub = null
    nearbyUnsub?.invoke()
    nearbyUnsub = null
    BlypShellNearbyScan.stopForChat()
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    chatVisible = true
    PaymentAnnouncePrefs.setActiveConversation(this, conversationId)
    BlypShellChatUnread.clear(this, conversationId)
    localReadAt = java.time.Instant.now().toString()
    BlypShellChatReceipts.markReadAsync(this, conversationId)
    BlypShellChatReceipts.markPresenceAsync(this, conversationId)
    window.decorView.removeCallbacks(presencePulse)
    window.decorView.postDelayed(presencePulse, 20_000L)
    paintOnline()
    bindFromCache(scrollEnd = false)
    window.decorView.removeCallbacks(lastSeenShow)
    window.decorView.removeCallbacks(lastSeenHide)
    findViewById<TextView>(R.id.blyp_chat_last_seen)?.visibility = View.GONE
    window.decorView.postDelayed(lastSeenShow, 1_500L)
    window.decorView.removeCallbacks(vanishSweep)
    if (BlypShellChatModes.vanishOn(this, conversationId)) {
      window.decorView.postDelayed(vanishSweep, 20_000L)
    }
  }

  override fun onPause() {
    if (BlypShellChatModes.incognito(this, conversationId)) {
      BlypShellChatModes.seal(this, conversationId)
    }
    window.decorView.removeCallbacks(lastSeenShow)
    window.decorView.removeCallbacks(lastSeenHide)
    window.decorView.removeCallbacks(vanishSweep)
    persistComposerDraftOnLeave()
    sendTyping(false)
    morePopup?.dismiss()
    reactPopup?.dismiss()
    chatVisible = false
    window.decorView.removeCallbacks(presencePulse)
    if (::listView.isInitialized) {
      findViewById<View>(R.id.blyp_chat_online)?.removeCallbacks(onlineRecheck)
    }
    PaymentAnnouncePrefs.setActiveConversation(this, null)
    BlypShellChatVoicePlayer.stop()
    super.onPause()
  }

  override fun onDestroy() {
    window.decorView.removeCallbacks(draftTextSave)
    findViewById<TextView?>(R.id.blyp_chat_day)?.removeCallbacks(dayHide)
    voiceUnsub?.invoke()
    voiceUnsub = null
    BlypShellChatVoicePlayer.setComposerProgress(null)
    BlypShellChatVoicePlayer.release()
    super.onDestroy()
  }

  private fun watchKeyboard(root: View) {
    root.viewTreeObserver.addOnGlobalLayoutListener {
      val rect = android.graphics.Rect()
      root.getWindowVisibleDisplayFrame(rect)
      val keypad = (root.rootView.height - rect.bottom).coerceAtLeast(0)
      val top = rect.top.coerceAtLeast(0)
      if (root.paddingTop == top && root.paddingBottom == keypad) return@addOnGlobalLayoutListener
      val near = isNearBottom()
      root.setPadding(0, top, 0, keypad)
      if (near && ::listView.isInitialized) listView.post { stickToEnd() }
    }
  }

  private fun isNearBottom(): Boolean {
    if (!::listView.isInitialized || !::adapter.isInitialized) return false
    val lm = listView.layoutManager as? LinearLayoutManager ?: return true
    val last = adapter.itemCount - 1
    if (last <= 0) return true
    val visible = lm.findLastVisibleItemPosition()
    if (visible == RecyclerView.NO_POSITION) return true
    return visible >= last - 1
  }

  private fun stickToEnd() {
    if (!::adapter.isInitialized) return
    val n = adapter.itemCount - 1
    if (n < 0) return
    listView.stopScroll()
    listView.scrollToPosition(n)
  }

  private fun revealStuckRows() {
    if (android.os.SystemClock.uptimeMillis() < glideUntil) return
    listView.post {
      for (i in 0 until listView.childCount) {
        val row = listView.getChildAt(i) ?: continue
        if (row.translationY != 0f && !row.hasTransientState()) {
          row.animate().cancel()
          row.translationY = 0f
          row.alpha = 1f
        }
      }
    }
  }

  private fun glideInLatest(soft: Boolean = false) {
    val n = adapter.itemCount - 1
    if (n < 0) return
    listView.stopScroll()
    listView.scrollToPosition(n)
    val vto = listView.viewTreeObserver
    vto.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        private var tries = 0

        override fun onPreDraw(): Boolean {
          tries += 1
          val lm = listView.layoutManager as? LinearLayoutManager
          val child = lm?.findViewByPosition(n)
          if (child == null || child.height <= 1) {
            if (tries > 6 && vto.isAlive) vto.removeOnPreDrawListener(this)
            listView.scrollToPosition(n)
            return true
          }
          val hidden = child.bottom - (listView.height - listView.paddingBottom)
          if (hidden > 1 && tries < 6) {
            listView.scrollBy(0, hidden)
            return false
          }
          if (vto.isAlive) vto.removeOnPreDrawListener(this)
          val dy = child.height.toFloat()
          val duration = if (soft) 460L else 280L
          glideUntil = android.os.SystemClock.uptimeMillis() + duration + 80L
          val ease =
            android.view.animation.DecelerateInterpolator(if (soft) 2.4f else 1.4f)
          for (i in 0 until listView.childCount) {
            val row = listView.getChildAt(i)
            row.animate().cancel()
            row.alpha = 1f
            row.translationY = dy
            row.animate().translationY(0f).setDuration(duration).setInterpolator(ease).withEndAction {
              row.translationY = 0f
            }.start()
          }
          return true
        }
      },
    )
  }

  private fun jumpToLatest() {
    val last = if (::adapter.isInitialized) adapter.itemCount - 1 else -1
    if (last < 0) return
    listView.stopScroll()
    listView.scrollToPosition(last)
    listView.post {
      val n = adapter.itemCount - 1
      if (n >= 0) listView.scrollToPosition(n)
      paintJump()
    }
  }

  private fun paintJump() {
    if (!::listView.isInitialized || !::adapter.isInitialized) return
    val lm = listView.layoutManager as? LinearLayoutManager ?: return
    val last = adapter.itemCount - 1
    val visible = lm.findLastVisibleItemPosition()
    findViewById<View>(R.id.blyp_chat_jump)?.visibility =
      if (last > 0 && visible >= 0 && visible < last) View.VISIBLE else View.GONE
  }

  private fun hapticReply() {
    val v = getSystemService(VIBRATOR_SERVICE) as? Vibrator ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      v.vibrate(VibrationEffect.createOneShot(18, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
      @Suppress("DEPRECATION")
      v.vibrate(18)
    }
  }

  private fun onMessageLongPress(row: ShellChatBubble, anchor: View) {
    if (row.deletedForAll) return
    hapticReply()
    dismissReactFan()
    clearReactChrome()
    val bubble =
      anchor.findViewById<View?>(R.id.blyp_chat_body)
        ?: anchor.findViewById(R.id.blyp_chat_image_strip)
        ?: anchor.findViewById(R.id.blyp_chat_voice_bubble)
        ?: anchor.findViewById(R.id.blyp_chat_doc_bubble)
        ?: anchor.findViewById(R.id.blyp_chat_money_bubble)
        ?: anchor.findViewById(R.id.blyp_chat_place_bubble)
        ?: anchor
    val d = resources.displayMetrics.density
    val myId = myUserId()?.trim().orEmpty()
    val mineEmoji = row.reactions.firstOrNull { it.userId == myId }?.emoji.orEmpty()
    val screenW = resources.displayMetrics.widthPixels
    val edge = (10 * d).toInt()
    val emojis = BlypShellReactionCodec.QUICK
    val cell = (28 * d).toInt()
    val fanGap = (8 * d).toInt()
    val fanPad = (4 * d).toInt()
    val fanW = emojis.size * cell + (emojis.size - 1) * fanGap + fanPad * 2
    val fanH = cell + fanPad * 2
    val push = (cell + 18 * d).toInt()

    val surface = ContextCompat.getColor(this, R.color.blyp_shell_surface)
    val accentSoft = ContextCompat.getColor(this, R.color.blyp_shell_accent_soft)
    val host =
      LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(fanPad, fanPad, fanPad, fanPad)
        clipChildren = false
        clipToPadding = false
        elevation = 0f
        background =
          android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
            cornerRadius = 22f * d
            setColor(surface)
          }
      }

    val emojiViews = ArrayList<TextView>(emojis.size)
    for ((index, emoji) in emojis.withIndex()) {
      val on = mineEmoji == emoji
      val btn =
        TextView(this).apply {
          text = emoji
          textSize = 17f
          gravity = Gravity.CENTER
          includeFontPadding = false
          elevation = 0f
          setLayerType(View.LAYER_TYPE_NONE, null)
          background =
            android.graphics.drawable.GradientDrawable().apply {
              shape = android.graphics.drawable.GradientDrawable.OVAL
              setColor(if (on) accentSoft else surface)
            }
          contentDescription = getString(R.string.blyp_shell_chat_react_pick_a11y, emoji)
          alpha = 0f
          scaleX = 0.35f
          scaleY = 0.35f
          isClickable = true
          setOnClickListener { picked ->
            for (v in emojiViews) v.isEnabled = false
            flyEmojiOntoBubble(picked as TextView, bubble, row, emoji)
          }
        }
      val lp =
        LinearLayout.LayoutParams(cell, cell).apply {
          if (index > 0) marginStart = fanGap
        }
      host.addView(btn, lp)
      emojiViews.add(btn)
    }

    armReactChrome(row.id)
    fun placeFanAndShow() {
      val bubbleLoc = IntArray(2)
      bubble.getLocationOnScreen(bubbleLoc)
      var fanLeft = (bubbleLoc[0] + bubble.width / 2f - fanW / 2f).toInt()
      fanLeft = fanLeft.coerceIn(edge, (screenW - fanW - edge).coerceAtLeast(edge))
      var fanTop = bubbleLoc[1] - fanH - (8 * d).toInt()
      if (fanTop < edge) fanTop = bubbleLoc[1] + bubble.height + (10 * d).toInt()
      // Overlay taille du éventail seulement (pas plein écran) → répondre/supprimer restent cliquables
      val content = findViewById<ViewGroup>(android.R.id.content)
      val contentLoc = IntArray(2)
      content.getLocationOnScreen(contentLoc)
      val lp =
        FrameLayout.LayoutParams(fanW, fanH).apply {
          leftMargin = fanLeft - contentLoc[0]
          topMargin = fanTop - contentLoc[1]
        }
      content.addView(host, lp)
      reactFanOverlay = host
      reactFanBubble = bubble
      val bounce = android.view.animation.OvershootInterpolator(1.8f)
      for ((i, btn) in emojiViews.withIndex()) {
        btn
          .animate()
          .alpha(1f)
          .scaleX(1f)
          .scaleY(1f)
          .setStartDelay(18L * i)
          .setDuration(220)
          .setInterpolator(bounce)
          .start()
      }
    }
    pushNeighborsAbove(bubble, push.toFloat())
    if (::listView.isInitialized) {
      listView.postDelayed({ placeFanAndShow() }, 100)
    } else {
      placeFanAndShow()
    }
    bubble.animate().scaleX(1.02f).scaleY(1.02f).setDuration(120)
      .setInterpolator(android.view.animation.DecelerateInterpolator()).start()
  }

  private fun flyEmojiOntoBubble(from: View, bubble: View, row: ShellChatBubble, emoji: String) {
    val root = window.decorView as? ViewGroup ?: return
    val d = resources.displayMetrics.density
    val start = IntArray(2)
    val end = IntArray(2)
    from.getLocationOnScreen(start)
    bubble.getLocationOnScreen(end)
    val size = (28 * d).toInt()
    val flyer =
      TextView(this).apply {
        text = emoji
        textSize = 18f
        gravity = Gravity.CENTER
        includeFontPadding = false
        background = ContextCompat.getDrawable(this@ShellChatThreadActivity, R.drawable.blyp_shell_react_chip)
      }
    root.addView(flyer, FrameLayout.LayoutParams(size, size))
    flyer.x = start[0].toFloat()
    flyer.y = start[1].toFloat()
    // Coin haut-gauche style iMessage
    val landX = end[0] - size * 0.28f
    val landY = end[1] - size * 0.28f
    val midX = (flyer.x + landX) / 2f
    val midY = minOf(flyer.y, landY) - 36 * d
    val path =
      android.graphics.Path().apply {
        moveTo(flyer.x, flyer.y)
        quadTo(midX, midY, landX, landY)
      }
    val bounce = android.view.animation.OvershootInterpolator(2.6f)
    android.animation.ObjectAnimator.ofFloat(flyer, View.X, View.Y, path).apply {
      duration = 360
      interpolator = android.view.animation.AccelerateDecelerateInterpolator()
      start()
    }
    flyer
      .animate()
      .scaleX(1.28f)
      .scaleY(1.28f)
      .setDuration(160)
      .withEndAction {
        flyer
          .animate()
          .scaleX(1f)
          .scaleY(1f)
          .setDuration(200)
          .setInterpolator(bounce)
          .withEndAction {
            (flyer.parent as? ViewGroup)?.removeView(flyer)
          }
          .start()
      }
      .start()
    dismissReactFan()
    reactBounceId = row.id
    window.decorView.postDelayed({ reactTo(row, emoji, burstFrom = null) }, 90)
  }

  private fun reactTo(row: ShellChatBubble, emoji: String, burstFrom: View? = null) {
    val phone = phone()
    val myId = myUserId()?.trim().orEmpty()
    if (phone.isEmpty() || myId.isEmpty() || row.deletedForAll) return
    val picked = emoji.trim()
    if (picked.isEmpty() || picked !in BlypShellReactionCodec.QUICK) return
    val previous = row.reactions
    val removing = previous.any { it.userId == myId && it.emoji == picked }
    val next =
      if (removing) {
        previous.filter { it.userId != myId }
      } else {
        previous.filter { it.userId != myId } + ShellChatReaction(picked, myId)
      }
    hapticReply()
    if (removing) {
      reactRemoveId = row.id
    } else {
      BlypShellChatSounds.playReact(this)
      if (burstFrom != null) {
        reactBounceId = row.id
        playReactBurst(burstFrom, picked)
      }
    }
    BlypShellChatMessagesStore.patchReactions(this, phone, conversationId, row.id, next)
    if (::adapter.isInitialized) adapter.patchReactions(row.id, next) else bindFromCache(scrollEnd = false)
    val syncEmoji = next.firstOrNull { it.userId == myId }?.emoji.orEmpty()
    val preview = BlypShellReactionCodec.listPreview(syncEmoji, mine = true)
    if (preview.isNotEmpty()) {
      BlypShellConversationsStore.touchIncoming(
        this,
        phone,
        conversationId,
        preview,
        java.time.Instant.now().toString(),
        "",
      )
    }
    val localOnly = row.outboundPending || row.id.startsWith("c-")
    if (localOnly) return
    BlypShellChatThreadActions.reactAsync(this, conversationId, row.id, picked) {
        reactions,
        ok,
      ->
      if (!ok) {
        BlypShellChatMessagesStore.patchReactions(this, phone, conversationId, row.id, previous)
        if (::adapter.isInitialized) adapter.patchReactions(row.id, previous)
        toast(getString(R.string.blyp_shell_chat_react_failed))
      } else {
        val final = reactions ?: next
        BlypShellChatMessagesStore.patchReactions(this, phone, conversationId, row.id, final)
        if (::adapter.isInitialized) adapter.patchReactions(row.id, final)
      }
    }
    // Sync léger pour l’autre téléphone (plié, jamais une bulle « Message »)
    val clientId = UUID.randomUUID().toString()
    BlypShellChatOutbox.send(
      this,
      phone,
      conversationId,
      BlypShellReactionCodec.encode(row.id, syncEmoji),
      clientId,
      null,
    ) { _ -> }
  }

  private fun playReactBurst(anchor: View?, emoji: String) {
    val root = window.decorView as? ViewGroup ?: return
    val from = anchor ?: return
    val d = resources.displayMetrics.density
    val loc = IntArray(2)
    from.getLocationOnScreen(loc)
    val burst =
      TextView(this).apply {
        text = emoji
        textSize = 26f
        includeFontPadding = false
        gravity = Gravity.CENTER
        scaleX = 0.4f
        scaleY = 0.4f
        alpha = 0.9f
        setLayerType(View.LAYER_TYPE_HARDWARE, null)
      }
    val size = (40 * d).toInt()
    root.addView(burst, FrameLayout.LayoutParams(size, size))
    burst.x = loc[0] + from.width / 2f - size / 2f
    burst.y = loc[1] + from.height / 2f - size / 2f
    val bounce = android.view.animation.OvershootInterpolator(3f)
    burst
      .animate()
      .scaleX(1.4f)
      .scaleY(1.4f)
      .setDuration(160)
      .setInterpolator(bounce)
      .withEndAction {
        burst
          .animate()
          .scaleX(1f)
          .scaleY(1f)
          .alpha(0f)
          .setDuration(160)
          .withEndAction { (burst.parent as? ViewGroup)?.removeView(burst) }
          .start()
      }
      .start()
  }

  private fun armDoubleTapHeart(view: View, row: ShellChatBubble) {
    val detector =
      android.view.GestureDetector(
        this,
        object : android.view.GestureDetector.SimpleOnGestureListener() {
          override fun onDown(e: MotionEvent): Boolean = true

          override fun onDoubleTap(e: MotionEvent): Boolean {
            if (!row.deletedForAll) reactTo(row, "❤️", burstFrom = view)
            return true
          }

          override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            toggleMeta(row.id)
            return true
          }
        },
      )
    view.setOnClickListener(null)
    view.setOnTouchListener { _, ev ->
      detector.onTouchEvent(ev)
      false
    }
  }

  internal fun confirmDeleteForEveryone(row: ShellChatBubble) {
    if (!canDeleteForEveryone(row)) return
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_chat_delete_all_confirm_title)
      .setMessage(R.string.blyp_shell_chat_delete_all_confirm_msg)
      .setNegativeButton(R.string.blyp_shell_chat_reply_cancel, null)
      .setPositiveButton(R.string.blyp_shell_status_delete_confirm) { _, _ ->
        deleteMessage(row, "everyone")
      }
      .show()
  }

  private fun deleteNeedsServer(row: ShellChatBubble): Boolean =
    !(row.clientId != null && row.clientId == row.id)

  private fun canDeleteForEveryone(row: ShellChatBubble): Boolean {
    if (!row.mine || row.deletedForAll || row.outboundPending) return false
    if (row.clientId != null && row.clientId == row.id) return true
    val created =
      try {
        java.time.Instant.parse(row.createdAt).toEpochMilli()
      } catch (_: Exception) {
        return false
      }
    if (System.currentTimeMillis() - created > 60 * 60 * 1000L) return false
    if (row.type == "money") {
      val st = row.moneyStatus?.trim().orEmpty()
      if (st.isNotEmpty() && st != "pending") return false
    }
    return true
  }

  private fun deleteRowView(row: ShellChatBubble): View? {
    val pos = cached.indexOfFirst { it.id == row.id }
    if (pos < 0) return null
    val holder = listView.findViewHolderForAdapterPosition(pos)
    if (holder != null) return holder.itemView
    return (listView.layoutManager as? LinearLayoutManager)?.findViewByPosition(pos)
  }

  private fun animateDeleteVanish(target: View, onDone: () -> Unit) {
    target.animate().cancel()
    target.alpha = 1f
    target
      .animate()
      .alpha(0f)
      .setDuration(200L)
      .setInterpolator(android.view.animation.DecelerateInterpolator())
      .withEndAction { onDone() }
      .start()
  }

  private fun deleteMessage(row: ShellChatBubble, scope: String) {
    val phone = phone()
    if (phone.isEmpty()) return
    shownMeta.remove(row.id)
    val myId = BlypShellRuntime.accessSubject(this)
    val runRemove = {
      BlypShellChatMessagesStore.applyDeleteLocal(this, phone, conversationId, row.id, scope)
      BlypShellConversationPreview.syncFromThread(this, phone, conversationId, myId)
      bindFromCache(scrollEnd = false)
      if (scope != "everyone" || deleteNeedsServer(row)) {
        BlypShellChatThreadActions.deleteAsync(this, conversationId, row.id, scope) { ok, tooLate ->
          if (ok) {
            BlypShellConversationPreview.syncFromThread(this, phone, conversationId, myId)
          } else {
            val msg =
              if (tooLate) {
                getString(R.string.blyp_shell_chat_delete_too_late)
              } else {
                getString(R.string.blyp_shell_chat_delete_failed)
              }
            toast(msg)
            BlypShellChatThreadSync.pullNow(applicationContext, phone, conversationId) {
              if (!isFinishing) {
                BlypShellConversationPreview.syncFromThread(this, phone, conversationId, myId)
                bindFromCache(scrollEnd = false)
              }
            }
          }
        }
      }
    }
    val target = deleteRowView(row)
    if (target == null) {
      runRemove()
      return
    }
    animateDeleteVanish(target, runRemove)
  }

  private fun canForward(row: ShellChatBubble): Boolean {
    if (row.deletedForAll || row.outboundPending || row.type == "money") return false
    return when (row.type) {
      "text" -> row.body.isNotBlank()
      "voice" -> !row.voiceKey.isNullOrEmpty()
      "image" -> !row.imageKey.isNullOrEmpty() || !row.localImagePath.isNullOrEmpty()
      "document" -> !row.documentKey.isNullOrEmpty()
      else -> false
    }
  }

  private fun openForward(row: ShellChatBubble) {
    forwardResult.launch(
      ShellForwardChatActivity.buildIntent(this, conversationId, listOf(row.id)),
    )
  }

  private fun onMoneyReceiptToggle(row: ShellChatBubble) {
    val transferId = row.moneyTransferId?.trim().orEmpty()
    if (transferId.isEmpty() || !row.mine || row.moneyStatus != "pending") return
    val next = !row.moneyReceiptRequired
    BlypShellChatMoneyReceiptToggle.setRequiredAsync(this, transferId, next) { ok, transfer ->
      if (!ok || transfer == null) {
        toast(getString(R.string.blyp_shell_chat_money_action_failed))
        return@setRequiredAsync
      }
      BlypShellChatMessagesStore.patchMoneyTransferById(
        this,
        phone(),
        conversationId,
        transferId,
        transfer,
      )
      bindFromCache(scrollEnd = false)
    }
  }

  private fun takeMoneySettle(row: ShellChatBubble): Boolean = moneySettleIds.remove(row.id)

  private fun takeClaimCelebration(row: ShellChatBubble): Boolean {
    val id = celebrateTransferId ?: return false
    if (row.mine || row.moneyStatus != "claimed" || row.moneyTransferId != id) return false
    celebrateTransferId = null
    return true
  }

  private fun onMoneyAction(row: ShellChatBubble) {
    val transferId = row.moneyTransferId?.trim().orEmpty()
    if (transferId.isEmpty() || !row.canMoneyAction()) return
    if (!row.mine && row.moneyReceiptRequired) {
      receiptClaimResult.launch(
        ShellChatMoneyReceiptActivity.buildIntent(
          this,
          conversationId,
          transferId,
          row.moneyAmountFcfa,
          peerName,
        ),
      )
      return
    }
    if (row.mine) {
      showMoneyEditDialog(row)
      return
    }
    runMoneyAction(row, "claim")
  }

  private fun showMoneyEditDialog(row: ShellChatBubble) {
    if (!row.canMoneyAction() || isFinishing) return
    val density = resources.displayMetrics.density
    val amountField =
      EditText(this).apply {
        setText(row.moneyAmountFcfa.takeIf { it > 0 }?.toString().orEmpty())
        inputType = android.text.InputType.TYPE_CLASS_NUMBER
        hint = getString(R.string.blyp_shell_chat_money_edit_amount)
        gravity = android.view.Gravity.CENTER
      }
    val motifField =
      EditText(this).apply {
        val note =
          row.body.trim().takeIf {
            it.isNotEmpty() && it.filter { ch -> ch.isDigit() } != row.moneyAmountFcfa.toString()
          }
        if (note != null) setText(note)
        hint = getString(R.string.blyp_shell_pay_motif_hint)
        inputType =
          android.text.InputType.TYPE_CLASS_TEXT or
            android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
            android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
        minLines = 2
        BlypShellPayMotif.bind(this)
      }
    fun label(textRes: Int) =
      TextView(this).apply {
        text = getString(textRes)
        setTextColor(ContextCompat.getColor(this@ShellChatThreadActivity, R.color.blyp_shell_text_secondary))
        textSize = 13f
        setPadding(0, (10 * density).toInt(), 0, (6 * density).toInt())
      }
    val box =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        addView(label(R.string.blyp_shell_chat_money_edit_amount))
        addView(
          amountField,
          LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
          ),
        )
        addView(label(R.string.blyp_shell_pay_motif_label))
        addView(
          motifField,
          LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
          ),
        )
      }
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_chat_money_edit_title)
      .setView(box)
      .setPositiveButton(R.string.blyp_shell_chat_money_edit_save) { _, _ ->
        val amount =
          amountField.text?.toString()?.replace(Regex("\\D"), "")?.toIntOrNull() ?: 0
        if (amount <= 0) {
          toast(getString(R.string.blyp_shell_chat_money_invalid))
          return@setPositiveButton
        }
        val motif = BlypShellPayMotif.sanitize(motifField.text)
        val oldNote =
          row.body.trim().takeIf {
            it.isNotEmpty() && it.filter { ch -> ch.isDigit() } != row.moneyAmountFcfa.toString()
          }
        if (amount == row.moneyAmountFcfa && motif == oldNote) return@setPositiveButton
        confirmMoneyEdit(row, amount, motif)
      }
      .setNeutralButton(R.string.blyp_shell_chat_money_reclaim) { _, _ ->
        confirmMoneyRecall(row)
      }
      .setNegativeButton(R.string.blyp_shell_chat_reply_cancel, null)
      .show()
  }

  private fun confirmMoneyRecall(row: ShellChatBubble) {
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_chat_money_reclaim_confirm_title)
      .setMessage(R.string.blyp_shell_chat_money_reclaim_confirm_msg)
      .setPositiveButton(R.string.blyp_shell_chat_money_reclaim) { _, _ ->
        runMoneyAction(row, "recall")
      }
      .setNegativeButton(R.string.blyp_shell_chat_reply_cancel, null)
      .show()
  }

  private fun confirmMoneyEdit(row: ShellChatBubble, amount: Int, motif: String?) {
    if (!BlypShellNetwork.isOnline(this)) {
      toast(getString(R.string.blyp_shell_chat_money_edit_failed))
      return
    }
    val pinStored =
      BlypShellPayRuntime.readPinOnly(this)?.filter { it.isDigit() }.orEmpty()
    if (pinStored.length != 4) {
      toast(getString(R.string.blyp_shell_chat_money_edit_failed))
      return
    }
    val fingerOk =
      try {
        androidx.biometric.BiometricManager.from(this)
          .canAuthenticate(
            androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG or
              androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK,
          ) == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS
      } catch (_: Exception) {
        false
      }
    if (fingerOk) {
      askMoneyEditFinger(row, amount, motif, pinStored)
      return
    }
    showMoneyEditPin(row, amount, motif)
  }

  private fun askMoneyEditFinger(
    row: ShellChatBubble,
    amount: Int,
    motif: String?,
    pin: String,
  ) {
    val prompt =
      androidx.biometric.BiometricPrompt(
        this,
        ContextCompat.getMainExecutor(this),
        object : androidx.biometric.BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (
              errorCode == androidx.biometric.BiometricPrompt.ERROR_USER_CANCELED ||
                errorCode == androidx.biometric.BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                errorCode == androidx.biometric.BiometricPrompt.ERROR_CANCELED
            ) {
              return
            }
            showMoneyEditPin(row, amount, motif)
          }

          override fun onAuthenticationSucceeded(
            result: androidx.biometric.BiometricPrompt.AuthenticationResult,
          ) {
            applyMoneyEdit(row, amount, motif, pin)
          }
        },
      )
    val info =
      androidx.biometric.BiometricPrompt.PromptInfo.Builder()
        .setTitle(getString(R.string.blyp_shell_chat_money_edit_pin_title))
        .setSubtitle(getString(R.string.blyp_shell_chat_money_bio_subtitle, amount))
        .setAllowedAuthenticators(
          androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG or
            androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK,
        )
        .setNegativeButtonText(getString(android.R.string.cancel))
        .build()
    try {
      prompt.authenticate(info)
    } catch (_: Exception) {
      showMoneyEditPin(row, amount, motif)
    }
  }

  private fun showMoneyEditPin(row: ShellChatBubble, amount: Int, motif: String?) {
    var sent = false
    lateinit var dialog: android.app.Dialog
    lateinit var pinView: EditText
    val pinBox =
      blypMaskedPin(this) { pin ->
          if (sent) return@blypMaskedPin
          sent = true
          dialog.dismiss()
          applyMoneyEdit(row, amount, motif, pin)
        }
        .also { pinView = it.second }
        .first
    dialog =
      BlypShellDialogs.alertBuilder(this)
        .setTitle(R.string.blyp_shell_chat_money_edit_pin_title)
        .setView(pinBox)
        .setNegativeButton(android.R.string.cancel, null)
        .create()
    dialog.setOnShowListener {
      pinView.requestFocus()
      pinView.post {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        imm.showSoftInput(pinView, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
      }
    }
    dialog.show()
  }

  private fun applyMoneyEdit(
    row: ShellChatBubble,
    amount: Int,
    motif: String?,
    pin: String,
  ) {
    val transferId = row.moneyTransferId?.trim().orEmpty()
    if (transferId.isEmpty() || claimingTransferId != null) return
    if (!row.canMoneyAction()) {
      toast(getString(R.string.blyp_shell_chat_money_edit_failed))
      return
    }
    claimingTransferId = transferId
    adapter.notifyMoneyRows()
    BlypShellChatMoneyClaim.claimAsync(this, transferId, "recall") { ok, _, balance ->
      if (!ok) {
        claimingTransferId = null
        adapter.notifyMoneyRows()
        toast(getString(R.string.blyp_shell_chat_money_edit_failed))
        return@claimAsync
      }
      balance?.let { BlypShellSession.updateBalance(this, it) }
      BlypShellChatMessagesStore.patchMoneyTransferById(
        this,
        phone(),
        conversationId,
        transferId,
        org.json.JSONObject()
          .put("transferId", transferId)
          .put("status", "claimed")
          .put("claimedByUserId", row.moneyFromUserId.orEmpty()),
      )
      bindFromCache(scrollEnd = false)
      val clientId = java.util.UUID.randomUUID().toString()
      val idem = java.util.UUID.randomUUID().toString()
      BlypShellChatMediaSend.sendMoneyAsync(
        this,
        conversationId,
        amount,
        clientId,
        idem,
        pin,
        motif,
        null,
      ) { sendOk, msg, newBal, pinWrong, _ ->
        claimingTransferId = null
        adapter.notifyMoneyRows()
        if (!sendOk || msg == null) {
          toast(
            getString(
              if (pinWrong) R.string.blyp_shell_chat_money_pin_wrong
              else R.string.blyp_shell_chat_money_edit_failed,
            ),
          )
          bindFromCache(scrollEnd = false)
          return@sendMoneyAsync
        }
        newBal?.let { BlypShellSession.updateBalance(this, it) }
        val local = BlypShellChatMessagesStore.loadRawObjects(this, phone(), conversationId)
        val merged = BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(msg))
        BlypShellChatMessagesStore.saveMerged(this, phone(), conversationId, merged)
        val newTid =
          msg.optJSONObject("moneyTransfer")?.optString("transferId").orEmpty()
            .ifEmpty { msg.optString("id") }
        BlypTransactionStore.insertMessageMoney(
          this,
          phone(),
          newTid.ifEmpty { clientId },
          amount,
          peerName.ifEmpty { "Message Money" },
          motif,
        )
        if (!motif.isNullOrBlank()) {
          BlypShellMotifSuggestions.noteUsed(this, conversationId, motif)
        }
        BlypShellUiRefresh.notifyWalletChanged()
        bindFromCache(scrollEnd = true)
      }
    }
  }

  private fun runMoneyAction(row: ShellChatBubble, action: String) {
    val transferId = row.moneyTransferId?.trim().orEmpty()
    if (transferId.isEmpty()) return
    claimingTransferId = transferId
    adapter.notifyMoneyRows()
    BlypShellChatMoneyClaim.claimAsync(this, transferId, action) { ok, transfer, balance ->
      claimingTransferId = null
      adapter.notifyMoneyRows()
      if (!ok || transfer == null) {
        toast(getString(R.string.blyp_shell_chat_money_action_failed))
        return@claimAsync
      }
      balance?.let { BlypShellSession.updateBalance(this, it) }
      if (action == "claim") celebrateTransferId = transferId
      BlypShellChatMessagesStore.patchMoneyTransferById(
        this,
        phone(),
        conversationId,
        transferId,
        transfer,
      )
      bindFromCache(scrollEnd = false)
    }
  }

  private fun playSentSound() {
    BlypShellChatSounds.playSend(this)
  }

  private fun sendPickedDocument(picked: BlypShellDocumentPick.Picked) {
    val phone = phone()
    val myId = myUserId()?.trim().orEmpty()
    if (phone.isEmpty() || myId.isEmpty()) return
    playSentSound()
    val clientId = UUID.randomUUID().toString()
    val reply = replyToId
    clearReply()
    val optimistic =
      BlypShellChatMessagesStore.optimisticDocument(
        conversationId,
        myId,
        clientId,
        picked.displayName,
        picked.sizeBytes,
        picked.contentType,
        picked.file.absolutePath,
      )
    val local = BlypShellChatMessagesStore.loadRawObjects(this, phone, conversationId)
    BlypShellChatMessagesStore.saveMerged(
      this,
      phone,
      conversationId,
      BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(optimistic)),
    )
    bindFromCache(scrollEnd = true)
    BlypShellChatMediaSend.sendDocumentAsync(
      this,
      conversationId,
      picked.file,
      picked.displayName,
      picked.sizeBytes,
      picked.contentType,
      clientId,
      reply,
    ) { ok, message ->
      if (!ok || message == null) {
        toast(getString(R.string.blyp_shell_chat_doc_failed))
        return@sendDocumentAsync
      }
      mergeServerMessage(phone, clientId, message)
    }
  }

  private fun armReply(row: ShellChatBubble) {
    if (row.deletedForAll) return
    replyToId = row.id
    replyPreview =
      when {
        row.type == "text" && row.body.isNotEmpty() -> row.body
        row.type == "image" -> getString(R.string.blyp_shell_chat_type_image)
        row.type == "voice" -> getString(R.string.blyp_shell_chat_type_voice)
        else -> row.body.ifEmpty { getString(R.string.blyp_shell_chat_type_other) }
      }
    replyText.text = replyPreview
    replyBar.visibility = View.VISIBLE
    input.requestFocus()
  }

  private fun clearReply() {
    replyToId = null
    replyPreview = null
    replyBar.visibility = View.GONE
  }

  private fun phone(): String = BlypShellSession.phone(this).orEmpty()

  private fun myUserId(): String? =
    BlypShellRuntime.accessSubject(this) ?: BlypShellSession.accountId(this)

  private fun bindPeerAvatar() {
    val avatar = findViewById<ImageView>(R.id.blyp_chat_peer_avatar)
    avatar.clipToOutline = true
    avatar.setImageResource(R.drawable.blyp_shell_contact_placeholder)
    val meta = BlypShellChatMessagesStore.conversationMeta(this, phone(), conversationId)
    val peerPhone =
      intent.getStringExtra(EXTRA_PEER_PHONE)?.trim().orEmpty().ifEmpty {
        meta?.optString("peerPhone").orEmpty()
      }
    val knownUrl =
      intent.getStringExtra(EXTRA_PEER_AVATAR)?.trim().orEmpty().ifEmpty {
        meta?.optString("peerAvatarUrl").orEmpty()
      }
    Thread {
        val local = BlypShellPhoneContacts.decodePhoto(applicationContext, peerPhone)
        val remote =
          if (local == null) {
            val url =
              knownUrl.ifBlank {
                BlypShellPeerAvatar.urlForPhone(applicationContext, peerPhone).orEmpty()
              }
            if (url.isBlank()) {
              null
            } else {
              BlypShellAvatarLoader.fetchBitmap(url, applicationContext)
            }
          } else {
            null
          }
        val bmp = local ?: remote
        runOnUiThread {
          if (!isDestroyed && bmp != null) avatar.setImageBitmap(bmp)
        }
      }.start()
  }

  private fun hugDayChip() {
    val day = findViewById<TextView>(R.id.blyp_chat_day)
    val lp =
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.WRAP_CONTENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      )
    val pad = (8 * resources.displayMetrics.density).toInt()
    lp.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
    lp.topMargin = pad
    day.layoutParams = lp
    val list = findViewById<RecyclerView>(R.id.blyp_chat_list)
    list.clipToPadding = true
    list.setPadding(list.paddingLeft, 0, list.paddingRight, list.paddingBottom)
  }

  private fun showDayChip() {
    val day = findViewById<TextView>(R.id.blyp_chat_day)
    day.animate().cancel()
    day.removeCallbacks(dayHide)
    val pos =
      (listView.layoutManager as? LinearLayoutManager)?.findFirstVisibleItemPosition()
        ?: RecyclerView.NO_POSITION
    val iso = if (pos >= 0) adapter.createdAtAt(pos) else null
    if (!iso.isNullOrBlank()) day.text = dayLabel(iso)
    if (day.text.isNullOrBlank()) return
    day.alpha = 1f
    day.visibility = View.VISIBLE
  }

  private fun scheduleDayHide() {
    val day = findViewById<TextView>(R.id.blyp_chat_day)
    day.removeCallbacks(dayHide)
    day.postDelayed(dayHide, 800L)
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (ev.action == MotionEvent.ACTION_DOWN) {
      val panel = findViewById<View>(R.id.blyp_chat_emoji_panel)
      val emojiBtn = findViewById<View>(R.id.blyp_chat_emoji)
      if (panel?.visibility == View.VISIBLE && !hit(panel, ev) && !hit(emojiBtn, ev)) closeEmoji()
      if (shownMeta.isNotEmpty() && !touchOnBubble(ev) && !touchOnMetaChrome(ev)) collapseMeta()
    }
    return super.dispatchTouchEvent(ev)
  }

  private fun hit(view: View?, ev: MotionEvent): Boolean {
    if (view == null || view.visibility != View.VISIBLE || view.width == 0) return false
    val loc = IntArray(2)
    view.getLocationOnScreen(loc)
    val x = ev.rawX
    val y = ev.rawY
    return x >= loc[0] && x <= loc[0] + view.width && y >= loc[1] && y <= loc[1] + view.height
  }

  private fun touchOnBubble(ev: MotionEvent): Boolean {
    if (!::listView.isInitialized) return false
    val ids =
      intArrayOf(
        R.id.blyp_chat_body,
        R.id.blyp_chat_money_bubble,
        R.id.blyp_chat_voice_bubble,
        R.id.blyp_chat_image_strip,
        R.id.blyp_chat_caption,
        R.id.blyp_chat_doc_bubble,
        R.id.blyp_chat_video_box,
      )
    for (i in 0 until listView.childCount) {
      val row = listView.getChildAt(i)
      for (id in ids) {
        if (hit(row.findViewById(id), ev)) return true
      }
    }
    return false
  }

  private fun touchOnMetaChrome(ev: MotionEvent): Boolean {
    if (!::listView.isInitialized) return false
    for (i in 0 until listView.childCount) {
      val row = listView.getChildAt(i)
      val del = row.findViewById<View?>(R.id.blyp_chat_meta_delete)
      if (del != null && del.visibility == View.VISIBLE && hit(del, ev)) return true
    }
    return false
  }

  private fun showLastSeen() {
    if (isFinishing || BlypShellChatTyping.isOn(conversationId)) return
    val tv = findViewById<TextView>(R.id.blyp_chat_last_seen) ?: return
    val ms =
      BlypShellChatReceipts.peerPresenceMs(conversationId).takeIf { it > 0L }
        ?: peerReadAt?.let {
          try {
            java.time.Instant.parse(it).toEpochMilli()
          } catch (_: Exception) {
            0L
          }
        }
        ?: 0L
    if (ms <= 0L) return
    val hm =
      java.time.format.DateTimeFormatter.ofPattern("HH:mm")
        .format(java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault()))
    tv.text = getString(R.string.blyp_shell_chat_last_seen, hm)
    val drop = 8f * resources.displayMetrics.density
    tv.animate().cancel()
    tv.visibility = View.VISIBLE
    tv.alpha = 0f
    tv.translationY = -drop
    tv.animate().alpha(1f).translationY(0f).setDuration(180).start()
    window.decorView.postDelayed(lastSeenHide, 5_000L)
  }

  private fun hideLastSeen() {
    val tv = findViewById<TextView>(R.id.blyp_chat_last_seen) ?: return
    if (tv.visibility != View.VISIBLE) return
    val drop = 8f * resources.displayMetrics.density
    tv.animate().cancel()
    tv.animate().alpha(0f).translationY(-drop).setDuration(180).withEndAction {
      tv.visibility = View.GONE
      tv.translationY = 0f
    }.start()
  }

  private fun sweepVanish() {
    if (isFinishing || !BlypShellChatModes.vanishOn(this, conversationId)) return
    bindFromCache(scrollEnd = false)
    window.decorView.postDelayed(vanishSweep, 20_000L)
  }

  private fun sharePlace() {
    val fine =
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!fine) {
      requestLocation.launch(Manifest.permission.ACCESS_FINE_LOCATION)
      return
    }
    pickPlaceMode()
  }

  private fun pickPlaceMode() {
    if (sending) return
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_chat_place_pick_title)
      .setItems(
        arrayOf(
          getString(R.string.blyp_shell_chat_place_pick_fixed),
          getString(R.string.blyp_shell_chat_place_pick_live),
        ),
      ) { _, which ->
        askPlaceNote(live = which == 1)
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun askPlaceNote(live: Boolean) {
    if (sending) return
    val density = resources.displayMetrics.density
    val field =
      EditText(this).apply {
        hint = getString(R.string.blyp_shell_chat_place_hint)
        inputType =
          android.text.InputType.TYPE_CLASS_TEXT or
            android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
            android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
        minLines = 1
        maxLines = 3
        filters = arrayOf(android.text.InputFilter.LengthFilter(120))
        setSingleLine(false)
        layoutParams =
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          )
      }
    val chipRow =
      LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
      }
    val suggestions = resources.getStringArray(R.array.blyp_shell_chat_place_note_suggestions)
    var selectedChip: TextView? = null
    fun paintChip(chip: TextView, on: Boolean) {
      chip.setBackgroundResource(
        if (on) R.drawable.blyp_shell_place_chip_on else R.drawable.blyp_shell_place_chip,
      )
      chip.setTextColor(
        ContextCompat.getColor(
          this,
          if (on) R.color.blyp_shell_accent_dark else R.color.blyp_shell_text,
        ),
      )
    }
    suggestions.forEachIndexed { index, label ->
      val chip =
        TextView(this).apply {
          text = label
          tag = label
          textSize = 13f
          setTypeface(typeface, android.graphics.Typeface.BOLD)
          setPadding(
            (14 * density).toInt(),
            (8 * density).toInt(),
            (14 * density).toInt(),
            (8 * density).toInt(),
          )
          layoutParams =
            LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.WRAP_CONTENT,
              ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { if (index > 0) marginStart = (8 * density).toInt() }
        }
      paintChip(chip, false)
      chip.setOnClickListener {
        val same = selectedChip === chip
        selectedChip?.let { paintChip(it, false) }
        if (same) {
          selectedChip = null
          field.setText("")
        } else {
          selectedChip = chip
          paintChip(chip, true)
          field.setText(label)
          field.setSelection(label.length)
        }
      }
      chipRow.addView(chip)
    }
    field.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          val now = s?.toString().orEmpty().trim()
          val match = chipRow.findViewWithTag<TextView>(now)
          if (selectedChip != null && selectedChip !== match) {
            selectedChip?.let { paintChip(it, false) }
            selectedChip = null
          }
          if (match != null && selectedChip !== match) {
            selectedChip = match
            paintChip(match, true)
          }
        }
      },
    )
    val scroller =
      android.widget.HorizontalScrollView(this).apply {
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        layoutParams =
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ).apply { topMargin = (12 * density).toInt() }
        addView(chipRow)
      }
    val box =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams =
          ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          )
        addView(field)
        addView(scroller)
      }
    BlypShellDialogs.alertBuilder(this)
      .setTitle(R.string.blyp_shell_chat_place_note_title)
      .setMessage(R.string.blyp_shell_chat_place_note_sub)
      .setView(box)
      .setPositiveButton(R.string.blyp_shell_chat_send) { _, _ ->
        sendPlaceHere(live = live, note = field.text?.toString().orEmpty())
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
    field.requestFocus()
  }

  private fun sendPlaceHere(live: Boolean, note: String = "") {
    if (sending) return
    if (live && BlypShellLivePlace.activeSessionId() != null) {
      toast(getString(R.string.blyp_shell_chat_place_busy))
      return
    }
    val loc =
      try {
        val lm = getSystemService(LocationManager::class.java)
        lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
          ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
      } catch (_: SecurityException) {
        null
      }
    if (loc == null) {
      toast(getString(R.string.blyp_shell_chat_place_missing))
      return
    }
    val phone = phone()
    val myId = myUserId()?.trim().orEmpty()
    if (phone.isEmpty() || myId.isEmpty()) {
      toast(getString(R.string.blyp_shell_chat_send_failed))
      return
    }
    val placeNote = note.trim().take(120)
    val sessionId = UUID.randomUUID().toString()
    val expiresAt = if (live) System.currentTimeMillis() + BlypShellPlaceCodec.LIVE_MS else 0L
    val clientId = UUID.randomUUID().toString()
    playSentSound()
    sending = true
    showSendSpin(clientId)
    hideKeyboard()
    val skeleton =
      BlypShellPlaceCodec.encodeStart(
        sessionId,
        loc.latitude,
        loc.longitude,
        expiresAt,
        stopped = !live,
        name = "",
        note = placeNote,
      )
    val optimistic =
      BlypShellChatMessagesStore.optimisticText(conversationId, myId, skeleton, clientId)
    val livePreview = getString(R.string.blyp_shell_chat_place_preview_live)
    val fixedPreview = getString(R.string.blyp_shell_chat_place_preview)
    Thread {
      BlypShellChatMessagesStore.upsertMessages(this, phone, conversationId, listOf(optimistic))
      BlypShellConversationsStore.touchIncoming(
        this,
        phone,
        conversationId,
        BlypShellPlaceCodec.previewLabel(
          BlypShellPlaceCodec.Place(
            sessionId,
            loc.latitude,
            loc.longitude,
            expiresAt,
            stopped = !live,
            note = placeNote,
          ),
          livePreview,
          fixedPreview,
        ),
        java.time.Instant.now().toString(),
        "",
      )
      runOnUiThread { if (!isFinishing) bindFromCache(scrollEnd = true) }
      val placeName =
        BlypShellPlaceName.sanitize(
          BlypShellPlaceName.resolve(this, loc.latitude, loc.longitude),
        )
      val body =
        BlypShellPlaceCodec.encodeStart(
          sessionId,
          loc.latitude,
          loc.longitude,
          expiresAt,
          stopped = !live,
          name = placeName,
          note = placeNote,
        )
      if (placeName.isNotEmpty() || placeNote.isNotEmpty()) {
        optimistic.put("body", body)
        BlypShellChatMessagesStore.upsertMessages(this, phone, conversationId, listOf(optimistic))
        BlypShellConversationsStore.touchIncoming(
          this,
          phone,
          conversationId,
          BlypShellPlaceCodec.previewLabel(
            BlypShellPlaceCodec.Place(
              sessionId,
              loc.latitude,
              loc.longitude,
              expiresAt,
              stopped = !live,
              name = placeName,
              note = placeNote,
            ),
            livePreview,
            fixedPreview,
          ),
          java.time.Instant.now().toString(),
          "",
        )
        runOnUiThread { if (!isFinishing) bindFromCache(scrollEnd = false) }
      }
      BlypShellChatOutbox.send(this, phone, conversationId, body, clientId, null) { ok ->
        sending = false
        if (isFinishing) return@send
        if (ok && live) {
          BlypShellLivePlace.start(this, conversationId, sessionId, expiresAt)
          BlypShellChatThreadPullGate.markPulled(conversationId)
        }
        bindFromCache(scrollEnd = true)
      }
    }.start()
  }

  private fun stopPlaceShare(sessionId: String) {
    BlypShellLivePlace.stop(this, sessionId, conversationId, notifyPeer = true)
    bindFromCache(scrollEnd = false)
  }

  private fun openPlaceMaps(lat: Double, lng: Double, name: String = "") {
    val label = name.trim().ifEmpty { "$lat,$lng" }
    try {
      val q = android.net.Uri.encode(label)
      val uri = android.net.Uri.parse("geo:$lat,$lng?q=$lat,$lng($q)")
      startActivity(Intent(Intent.ACTION_VIEW, uri))
    } catch (_: Exception) {
      try {
        startActivity(
          Intent(Intent.ACTION_VIEW, android.net.Uri.parse(BlypShellPlaceCodec.mapsUrl(lat, lng))),
        )
      } catch (_: Exception) {
        toast(getString(R.string.blyp_shell_chat_place_missing))
      }
    }
  }

  private fun paintOnline() {
    val dot = findViewById<View>(R.id.blyp_chat_online)
    val on = BlypShellChatReceipts.peerOnline(conversationId)
    dot.visibility = if (on) View.VISIBLE else View.GONE
    dot.removeCallbacks(onlineRecheck)
    if (on) dot.postDelayed(onlineRecheck, 5_000L)
  }

  private fun dayLabel(iso: String?): String {
    val zone = java.time.ZoneId.systemDefault()
    val today = java.time.LocalDate.now(zone)
    val day =
      try {
        if (iso.isNullOrBlank()) today
        else java.time.Instant.parse(iso).atZone(zone).toLocalDate()
      } catch (_: Exception) {
        today
      }
    return when {
      day == today -> getString(R.string.blyp_shell_chat_today)
      day == today.minusDays(1) -> getString(R.string.blyp_shell_chat_yesterday)
      day.year == today.year ->
        java.time.format.DateTimeFormatter.ofPattern("d MMMM", java.util.Locale.getDefault()).format(day)
      else ->
        java.time.format.DateTimeFormatter.ofPattern("d MMMM yyyy", java.util.Locale.getDefault()).format(day)
    }
  }

  private fun loadPeerName(): String {
    val meta =
      BlypShellChatMessagesStore.conversationMeta(
        this,
        phone(),
        conversationId,
      )
    return meta?.optString("peerName")?.trim().orEmpty().ifEmpty { "…" }
  }

  private fun bindFromCache(scrollEnd: Boolean) {
    val loaded =
      BlypShellChatMessagesStore.loadBubbles(
        this,
        phone(),
        conversationId,
        myUserId(),
      )
    val keptPending =
      cached.filter { old ->
        old.outboundPending &&
          loaded.none { it.id == old.id || (old.clientId != null && it.clientId == old.clientId) }
      }
    val next =
      if (keptPending.isEmpty()) loaded
      else (loaded + keptPending).sortedBy { it.createdAt }
    findViewById<View>(R.id.blyp_chat_busy)?.visibility =
      if (next.isEmpty() && !chatSynced) View.VISIBLE else View.GONE
    paintOnline()
    val phone = phone()
    val peer = BlypShellChatReceipts.peerReadAt(this, phone, conversationId)
    var local = localReadAt
    if (chatVisible) {
      val now = java.time.Instant.now().toString()
      local = laterIso(local, now)
      for (bubble in next) {
        if (!bubble.mine) local = laterIso(local, bubble.createdAt)
      }
      localReadAt = local
    }
    val readsChanged = peer != peerReadAt || local != adapter.localReadAt || peer != adapter.peerReadAt
    peerReadAt = peer
    adapter.peerReadAt = peer
    adapter.localReadAt = local
    if (!arrivalKeyboardDone) {
      arrivalKeyboardDone = true
      if (next.isEmpty()) showKeyboard()
    }
    val stamp =
      next.joinToString(",") {
        if (!it.outboundPending) "" else it.id + ":" + BlypShellChatOutbox.pendingLabel(it.clientId)
      }
    val stampChanged = stamp != pendingStamp
    pendingStamp = stamp
    val wasPending = cached.filter { it.outboundPending }.map { it.id }.toSet()
    val justSent =
      next.filter { bubble ->
        bubble.mine &&
          !bubble.outboundPending &&
          (bubble.id in wasPending || (bubble.clientId != null && bubble.clientId in wasPending)) &&
          bubble.id !in sentFlashUntil
      }
    if (justSent.isNotEmpty()) markSentFlash(justSent.map { it.id })
    val brandNew = next.filter { it.id !in seenBubbleIds }
    val removed = seenBubbleIds.any { old -> next.none { it.id == old } }
    val swap = removed && brandNew.isNotEmpty() && brandNew.all { it.mine }
    seenBubbleIds.addAll(next.map { it.id })
    val firstPaint = !seenPrimed
    seenPrimed = true
    if (!firstPaint && !swap && brandNew.isNotEmpty() && brandNew.size <= 3) {
      adapter.markArrivals(brandNew.map { it.id })
      if (chatVisible && brandNew.any { !it.mine }) {
        BlypShellMessageBanner.chime(this)
        val moneyHit = brandNew.any { !it.mine && it.type == "money" }
        if (moneyHit) BlypShellIncomingBuzz.money(this)
        else BlypShellIncomingBuzz.message(this)
      }
    }
    BlypShellChatTranslate.ensure(this, conversationId, next) {
      if (!isFinishing && ::adapter.isInitialized) adapter.notifyTranslations()
    }
    val spinId = sendSpinId
    val voiceReady =
      spinId != null &&
        next.any { it.type == "voice" && (it.id == spinId || it.clientId == spinId) }
    if (voiceReady) hideSendSpinNow()
    else if (spinId != null && next.any { it.id == spinId || it.clientId == spinId }) hideSendSpin()
    if (bubblesEqual(cached, next) && !readsChanged && !stampChanged) return
    moneySettleIds.clear()
    if (!firstPaint) {
      for (bubble in next) {
        if (bubble.type != "money") continue
        val prev = cached.find { it.id == bubble.id } ?: continue
        val now = bubble.moneyStatus
        if (prev.moneyStatus == "pending" && (now == "claimed" || now == "cancelled")) {
          moneySettleIds.add(bubble.id)
        }
      }
    }
    cached = next
    BlypShellChatMediaWarm.warmThread(this, conversationId, next)
    val near = isNearBottom()
    val mode = adapter.submit(next)
    val outgoing = !firstPaint && !swap && brandNew.any { it.mine }
    val incoming = !firstPaint && brandNew.any { !it.mine } && mode != "same"
    if (mode == "same") revealStuckRows()
    if (incoming && (near || scrollEnd)) {
      glideInLatest(soft = true)
    } else if (scrollEnd && next.isNotEmpty() && mode != "same") {
      if (mode == "append") glideInLatest() else jumpToLatest()
    }
  }

  private fun laterIso(a: String?, b: String?): String? {
    val left = a?.trim().orEmpty()
    val right = b?.trim().orEmpty()
    if (left.isEmpty()) return right.ifEmpty { null }
    if (right.isEmpty()) return left
    return if (BlypShellChatReceipts.seen(right, left)) left else right
  }

  private fun bubblesEqual(a: List<ShellChatBubble>, b: List<ShellChatBubble>): Boolean {
    if (a.size != b.size) return false
    for (i in a.indices) {
      val x = a[i]
      val y = b[i]
      if (
        x.id != y.id ||
        x.body != y.body ||
        x.type != y.type ||
        x.imageKey != y.imageKey ||
        x.voiceKey != y.voiceKey ||
        x.documentKey != y.documentKey ||
        x.moneyStatus != y.moneyStatus ||
        x.moneyClaimedByUserId != y.moneyClaimedByUserId ||
        x.outboundPending != y.outboundPending ||
        x.localImagePath != y.localImagePath ||
        x.imageAlbumId != y.imageAlbumId ||
        x.reactionLine() != y.reactionLine()
      ) {
        return false
      }
    }
    return true
  }

  private fun stagePhotos(files: List<File>) {
    pendingPhotos.addAll(files)
    paintPendingPhotos()
    paintSend()
  }

  private fun startCamera() {
    if (
      ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      cameraPermission.launch(Manifest.permission.CAMERA)
      return
    }
    launchCamera()
  }

  private fun launchCamera() {
    val file = File(cacheDir, "chat-camera-${System.currentTimeMillis()}.jpg")
    cameraFile = file
    val uri =
      FileProvider.getUriForFile(this, "${packageName}.blyp.shell.fileprovider", file)
    try {
      takePicture.launch(uri)
    } catch (_: Exception) {
      cameraFile = null
      toast(getString(R.string.blyp_shell_chat_send_failed))
    }
  }

  private fun pulseTyping() {
    val hasText = input.text?.toString()?.trim().orEmpty().isNotEmpty()
    if (!hasText) {
      sendTyping(false)
      return
    }
    val now = android.os.SystemClock.elapsedRealtime()
    if (!typingSentOn || now - typingPulseAt >= 2_000L) {
      typingPulseAt = now
      sendTyping(true)
    }
    input.removeCallbacks(typingIdle)
    input.postDelayed(typingIdle, 3_500L)
  }

  private fun sendTyping(on: Boolean) {
    if (on == typingSentOn) return
    typingSentOn = on
    if (!on) {
      typingPulseAt = 0L
      if (::input.isInitialized) input.removeCallbacks(typingIdle)
    }
    BlypShellChatTyping.send(this, conversationId, on)
  }

  private fun paintTyping() {
    val view = findViewById<TextView>(R.id.blyp_chat_typing) ?: return
    val on = BlypShellChatTyping.isOn(conversationId)
    view.visibility = if (on) View.VISIBLE else View.GONE
    if (on) findViewById<TextView>(R.id.blyp_chat_last_seen)?.visibility = View.GONE
  }

  private fun lightTool(which: Int) {
    toolLit = which
    paintTools()
  }

  private fun paintTools() {
    val accent = ContextCompat.getColor(this, R.color.blyp_shell_accent)
    val ink = ContextCompat.getColor(this, R.color.blyp_shell_text)
    val muted = ContextCompat.getColor(this, R.color.blyp_shell_muted)
    fun apply(icon: Int, label: Int, on: Boolean) {
      findViewById<ImageView>(icon)?.setColorFilter(if (on) accent else ink)
      findViewById<TextView>(label)?.setTextColor(if (on) accent else muted)
    }
    apply(R.id.blyp_chat_money_icon, R.id.blyp_chat_money_label, false)
    apply(R.id.blyp_chat_mic_icon, R.id.blyp_chat_mic_label, voiceMode == 1)
    apply(R.id.blyp_chat_more_icon, R.id.blyp_chat_more_label, toolLit == R.id.blyp_chat_more)
  }

  private fun openMore() {
    if (morePopup?.isShowing == true) {
      morePopup?.dismiss()
      return
    }
    lightTool(R.id.blyp_chat_more)
    val content = layoutInflater.inflate(R.layout.blyp_shell_chat_more, null)
    content.findViewById<View>(R.id.blyp_chat_more_camera).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      startCamera()
    }
    content.findViewById<View>(R.id.blyp_chat_more_photos).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      pickImages.launch("image/*")
    }
    content.findViewById<View>(R.id.blyp_chat_more_files).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      pickDocument.launch(arrayOf("*/*"))
    }
    content.findViewById<View>(R.id.blyp_chat_more_film).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      pickDocument.launch(arrayOf("video/*"))
    }
    content.findViewById<View>(R.id.blyp_chat_more_place).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      sharePlace()
    }
    content.findViewById<View>(R.id.blyp_chat_more_vanish).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      val on = !BlypShellChatModes.vanishOn(this, conversationId)
      BlypShellChatModes.setVanish(this, conversationId, on)
      toast(getString(if (on) R.string.blyp_shell_chat_vanish_on else R.string.blyp_shell_chat_vanish_off))
      if (on) window.decorView.postDelayed(vanishSweep, 20_000L)
    }
    content.findViewById<View>(R.id.blyp_chat_more_incognito).setOnClickListener {
      toolLit = 0
      morePopup?.dismiss()
      val on = !BlypShellChatModes.incognito(this, conversationId)
      BlypShellChatModes.setIncognito(this, conversationId, on)
      toast(getString(if (on) R.string.blyp_shell_chat_incognito_on else R.string.blyp_shell_chat_incognito_off))
    }
    val popup =
      android.widget.PopupWindow(
        content,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        true,
      )
    popup.setBackgroundDrawable(
      android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT),
    )
    popup.elevation = 12f
    popup.setOnDismissListener {
      if (toolLit == R.id.blyp_chat_more) lightTool(0)
    }
    morePopup = popup
    val anchor = findViewById<View>(R.id.blyp_chat_more)
    content.measure(
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
    )
    popup.showAsDropDown(anchor, 0, -(anchor.height + content.measuredHeight + 12))
  }

  private fun paintPendingPhotos() {
    val scroller = findViewById<View>(R.id.blyp_chat_pending_photos)
    val row = findViewById<LinearLayout>(R.id.blyp_chat_pending_row)
    row.removeAllViews()
    if (pendingPhotos.isEmpty()) {
      scroller.visibility = View.GONE
      paintTools()
      return
    }
    scroller.visibility = View.VISIBLE
    val d = resources.displayMetrics.density
    val size = (76 * d).toInt()
    val gap = (8 * d).toInt()
    val radius = 14 * d
    for (file in pendingPhotos.toList()) {
      val frame = FrameLayout(this)
      frame.layoutParams =
        LinearLayout.LayoutParams(size, size).apply { marginEnd = gap }
      val img = ImageView(this)
      img.layoutParams = FrameLayout.LayoutParams(size, size)
      img.scaleType = ImageView.ScaleType.CENTER_CROP
      img.outlineProvider =
        object : ViewOutlineProvider() {
          override fun getOutline(view: View, outline: Outline) {
            outline.setRoundRect(0, 0, view.width, view.height, radius)
          }
        }
      img.clipToOutline = true
      img.setImageBitmap(decodeThumb(file))
      val close = TextView(this)
      close.text = "×"
      close.gravity = Gravity.CENTER
      close.setTextColor(0xFFFFFFFF.toInt())
      close.textSize = 16f
      close.contentDescription = getString(R.string.blyp_shell_chat_pending_remove)
      val closeSize = (22 * d).toInt()
      close.layoutParams =
        FrameLayout.LayoutParams(closeSize, closeSize).apply {
          gravity = Gravity.TOP or Gravity.END
          topMargin = (4 * d).toInt()
          marginEnd = (4 * d).toInt()
        }
      close.background =
        android.graphics.drawable.GradientDrawable().apply {
          shape = android.graphics.drawable.GradientDrawable.OVAL
          setColor(0xCC000000.toInt())
        }
      close.setOnClickListener {
        pendingPhotos.remove(file)
        paintPendingPhotos()
        paintSend()
      }
      frame.addView(img)
      frame.addView(close)
      row.addView(frame)
    }
    paintTools()
  }

  private fun decodeThumb(file: File): android.graphics.Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    var sample = 1
    while (bounds.outWidth / sample > 360) sample *= 2
    return BitmapFactory.decodeFile(
      file.absolutePath,
      BitmapFactory.Options().apply { inSampleSize = sample },
    )
  }

  private fun sendPendingPhotos() {
    val files = pendingPhotos.toList()
    if (files.isEmpty()) return
    playSentSound()
    pendingPhotos.clear()
    paintPendingPhotos()
    paintSend()
    val albumId = if (files.size > 1) UUID.randomUUID().toString() else null
    files.forEachIndexed { index, file ->
      sendPickedImage(
        file,
        useCaption = index == 0,
        timeSkewMs = index.toLong(),
        albumId = albumId,
        notify = index == files.lastIndex,
      )
    }
  }

  private fun sendPickedImage(
    file: File,
    useCaption: Boolean = true,
    timeSkewMs: Long = 0L,
    albumId: String? = null,
    notify: Boolean = true,
  ) {
    val phone = phone()
    val myId = myUserId()?.trim().orEmpty()
    if (phone.isEmpty() || myId.isEmpty()) return
    val clientId = UUID.randomUUID().toString()
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    val width = bounds.outWidth.coerceAtLeast(0)
    val height = bounds.outHeight.coerceAtLeast(0)
    val caption = if (useCaption) input.text.toString().trim().ifEmpty { null } else null
    val optimistic =
      BlypShellChatMessagesStore.optimisticImage(
        conversationId,
        myId,
        clientId,
        file.absolutePath,
        width,
        height,
        albumId,
      )
    if (timeSkewMs > 0) {
      optimistic.put(
        "createdAt",
        java.time.Instant.now().plusMillis(timeSkewMs).toString(),
      )
    }
    if (!caption.isNullOrEmpty()) optimistic.put("body", caption)
    val reply = replyToId
    if (!reply.isNullOrBlank()) optimistic.put("replyToMessageId", reply)
    val local = BlypShellChatMessagesStore.loadRawObjects(this, phone, conversationId)
    BlypShellChatMessagesStore.saveMerged(
      this,
      phone,
      conversationId,
      BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(optimistic)),
    )
    decodeThumb(file)?.let { bmp ->
      BlypShellChatImageLoader.remember(clientId, bmp)
      BlypShellChatImageLoader.remember(file.absolutePath, bmp)
    }
    BlypShellChatOutbox.install(this)
    if (notify) {
      bindFromCache(scrollEnd = true)
      BlypShellConversationPreview.syncFromThread(
        this,
        phone,
        conversationId,
        myId,
      )
    }
    if (useCaption) input.setText("")
    clearReply()
    if (!BlypShellNetwork.isOnline(this)) {
      BlypShellChatOutbox.noteWaiting(clientId)
      bindFromCache(scrollEnd = false)
      return
    }
    BlypShellChatMediaSend.sendImageAsync(
      this,
      conversationId,
      file,
      width,
      height,
      clientId,
      caption,
      reply,
    ) { ok, msg ->
      if (ok && msg != null) {
        BlypShellChatOutbox.clearWaiting(clientId)
        mergeServerMessage(phone, clientId, msg)
        return@sendImageAsync
      }
      BlypShellChatOutbox.noteWaiting(clientId)
      bindFromCache(scrollEnd = false)
    }
  }

  private fun onMicTouch(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        if (voiceMode != 0) return true
        if (
          ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
          requestMic.launch(Manifest.permission.RECORD_AUDIO)
          return true
        }
        voiceDownX = event.rawX
        voiceDownY = event.rawY
        voiceCancelArmed = false
        voiceLocked = false
        beginVoiceRecording()
        voiceFingerDown = voiceMode == 1
        if (voiceFingerDown) hapticReply()
      }
      MotionEvent.ACTION_MOVE -> {
        if (!voiceFingerDown || voiceLocked || voiceMode != 1) return true
        val d = resources.displayMetrics.density
        val dx = event.rawX - voiceDownX
        val dy = event.rawY - voiceDownY
        voiceCancelArmed = dx < -88f * d
        val hint = findViewById<TextView>(R.id.blyp_chat_voice_hint)
        hint?.translationX = dx.coerceIn(-120f * d, 0f)
        hint?.alpha = (1f + dx / (140f * d)).coerceIn(0.3f, 1f)
        hint?.setTextColor(
          ContextCompat.getColor(
            this,
            if (voiceCancelArmed) R.color.blyp_shell_destructive else R.color.blyp_shell_muted,
          ),
        )
        val lock = findViewById<TextView>(R.id.blyp_chat_voice_lock)
        val rising = dy < -36f * d
        lock?.setTextColor(
          ContextCompat.getColor(
            this,
            if (rising) R.color.blyp_shell_accent else R.color.blyp_shell_muted,
          ),
        )
        if (dy < -72f * d) lockVoice()
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        if (!voiceFingerDown) return true
        voiceFingerDown = false
        if (voiceLocked) return true
        if (voiceCancelArmed || event.actionMasked == MotionEvent.ACTION_CANCEL) discardVoice()
        else finishAndSendVoice()
      }
    }
    return true
  }

  private fun lockVoice() {
    if (voiceLocked || voiceMode != 1) return
    voiceLocked = true
    voiceFingerDown = false
    hapticReply()
    showVoiceBar(recording = true, locked = true)
  }

  private fun finishAndSendVoice() {
    if (voiceMode == 0 || voiceSending) return
    if (voiceMode == 2) {
      val file = voicePreview ?: return
      voiceSending = true
      BlypShellChatDraft.clearVoice(this, conversationId)
      voiceMode = 0
      hideVoiceBar()
      deliverVoice(file, voicePreviewMs)
      return
    }
    voiceSending = true
    window.decorView.removeCallbacks(voiceTicker)
    BlypShellChatVoicePlayer.stop()
    voicePreview = null
    voiceMode = 0
    voiceLocked = false
    voiceFingerDown = false
    voiceCancelArmed = false
    hideVoiceBar()
    BlypShellChatDraft.clearVoice(this, conversationId)
    showSendSpin("voice-send", immediate = true)
    window.decorView.post {
      if (isFinishing) return@post
      val taken = ShellChatVoiceRecorder.take()
      if (taken == null) {
        voiceSending = false
        hideSendSpinNow()
        toast(getString(R.string.blyp_shell_chat_voice_too_short))
        return@post
      }
      Thread {
        val file = ShellChatVoiceRecorder.mixTaken(this, taken.first)
        runOnUiThread {
          if (isFinishing) return@runOnUiThread
          if (file == null) {
            voiceSending = false
            hideSendSpinNow()
            toast(getString(R.string.blyp_shell_chat_voice_failed))
            return@runOnUiThread
          }
          deliverVoice(file, taken.second)
        }
      }.start()
    }
  }

  private fun beginVoiceRecording() {
    if (!ShellChatVoiceRecorder.start(this)) {
      toast(getString(R.string.blyp_shell_chat_voice_failed))
      return
    }
    voiceMode = 1
    runCatching { BlypShellChatVoiceDuck.enter(this) }
    voiceStartedAt = System.currentTimeMillis()
    runCatching { findViewById<BlypShellVoiceWaveView>(R.id.blyp_chat_voice_wave)?.resetLive() }
    runCatching { showVoiceBar(recording = true, locked = false) }
    window.decorView.post(voiceTicker)
  }

  private fun pauseVoiceForPreview() {
    window.decorView.removeCallbacks(voiceTicker)
    val recorded = ShellChatVoiceRecorder.pause(this)
    if (recorded == null) {
      voiceMode = 0
      BlypShellChatVoiceDuck.leave(this)
      hideVoiceBar()
      toast(getString(R.string.blyp_shell_chat_voice_too_short))
      return
    }
    voiceRaw = recorded.first
    voicePreview = recorded.first
    voicePreviewMs = recorded.second
    bakePreview()
    voiceMode = 2
    showVoiceBar(recording = false)
    findViewById<BlypShellVoiceWaveView>(R.id.blyp_chat_voice_wave)?.freeze()
    findViewById<TextView>(R.id.blyp_chat_voice_clock)?.text = voiceClock(voicePreviewMs.toLong())
  }

  private fun continueVoice() {
    BlypShellChatVoicePlayer.stop()
    if (!ShellChatVoiceRecorder.resume(this)) {
      toast(getString(R.string.blyp_shell_chat_voice_failed))
      return
    }
    voiceMode = 1
    voiceStartedAt = System.currentTimeMillis() - voicePreviewMs
    BlypShellChatVoiceDuck.enter(this)
    showVoiceBar(recording = true)
    window.decorView.post(voiceTicker)
  }

  private fun onVoiceTransport() {
    if (BlypShellChatVoicePlayer.isPlaying("voice-preview")) {
      BlypShellChatVoicePlayer.pausePlayback()
      paintVoiceTransport()
      return
    }
    val file = voicePreview ?: return
    BlypShellChatVoicePlayer.play(file, "voice-preview") {
      toast(getString(R.string.blyp_shell_chat_voice_play_failed))
    }
    BlypShellChatVoicePlayer.seekTo(0)
    paintVoiceTransport()
  }

  private fun paintVoiceTransport() {
    val pause = voiceMode == 1 || BlypShellChatVoicePlayer.isPlaying("voice-preview")
    val action = findViewById<ImageView>(R.id.blyp_chat_voice_action) ?: return
    action.setImageResource(
      if (pause) R.drawable.blyp_shell_voice_pause else R.drawable.blyp_shell_voice_play,
    )
    action.visibility = View.VISIBLE
  }

  private fun closeEmoji() {
    findViewById<View>(R.id.blyp_chat_emoji_panel)?.visibility = View.GONE
  }

  private fun toggleEmoji() {
    val panel = findViewById<View>(R.id.blyp_chat_emoji_panel) ?: return
    if (panel.visibility == View.VISIBLE) {
      panel.visibility = View.GONE
      return
    }
    val grid = findViewById<GridLayout>(R.id.blyp_chat_emoji_grid)
    if (grid.childCount == 0) {
      val emojis =
        listOf(
          "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
          "🙂", "😉", "😊", "😍", "😘", "😜", "🤗", "🤔",
          "😐", "😴", "😮", "😢", "😭", "😡", "👍", "👎",
          "👏", "🙏", "💪", "🔥", "❤️", "💙", "💚", "💛",
          "💜", "🖤", "🤍", "💯", "✨", "🎉", "✅", "❌",
          "⭐", "🌹", "🍻", "🎁", "🏠", "🚗", "⚽", "🎵",
          "📷", "📞", "💬", "👋", "🤝", "👀", "😎", "🥳",
        )
      for (emoji in emojis) {
        val cell =
          TextView(this).apply {
            text = emoji
            textSize = 24f
            gravity = Gravity.CENTER
            setPadding(0, 10, 0, 10)
            setOnClickListener {
              val start = input.selectionStart.coerceAtLeast(0)
              input.text.insert(start, emoji)
              input.setSelection((start + emoji.length).coerceAtMost(input.text.length))
            }
          }
        grid.addView(
          cell,
          GridLayout.LayoutParams().apply {
            width = 0
            columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
          },
        )
      }
    }
    panel.visibility = View.VISIBLE
  }

  private fun playVoicePreview() {
    val file = voicePreview ?: return
    BlypShellChatVoicePlayer.toggleFile(this, "voice-preview", file) {
      toast(getString(R.string.blyp_shell_chat_voice_play_failed))
    }
  }

  private fun sendVoicePreview() {
    if (voiceSending) return
    finishAndSendVoice()
  }

  private val draftTextSave =
    Runnable {
      if (isFinishing) return@Runnable
      BlypShellChatDraft.saveText(this, conversationId, input.text.toString())
    }

  private fun scheduleDraftTextSave() {
    window.decorView.removeCallbacks(draftTextSave)
    window.decorView.postDelayed(draftTextSave, 280L)
  }

  private fun restoreComposerDraft() {
    val text = BlypShellChatDraft.loadText(this, conversationId)
    if (text.isNotEmpty()) input.setText(text)
    when (BlypShellChatDraft.loadVoiceKind(this, conversationId)) {
      BlypShellChatDraft.VoiceKind.PREVIEW -> {
        val file = BlypShellChatDraft.loadVoicePreviewFile(this, conversationId) ?: return
        voicePreview = file
        voicePreviewMs = BlypShellChatDraft.loadVoicePreviewMs(this, conversationId)
        voiceMode = 2
        showVoiceBar(recording = false)
        findViewById<TextView>(R.id.blyp_chat_voice_clock)?.text =
          voiceClock(voicePreviewMs.toLong())
        findViewById<BlypShellVoiceWaveView>(R.id.blyp_chat_voice_wave)?.freeze()
      }
      BlypShellChatDraft.VoiceKind.RECORDING -> Unit
      null -> Unit
    }
  }

  private fun persistComposerDraftOnLeave() {
    BlypShellChatDraft.saveText(this, conversationId, input.text.toString())
    when (voiceMode) {
      1 -> {
        window.decorView.removeCallbacks(voiceTicker)
        val recorded = ShellChatVoiceRecorder.pause(this)
        voiceLocked = false
        voiceFingerDown = false
        if (recorded != null) {
          voiceRaw = recorded.first
          voicePreview = recorded.first
          voicePreviewMs = recorded.second
          bakePreview()
          BlypShellChatDraft.saveVoicePreview(
            this,
            conversationId,
            voicePreview,
            voicePreviewMs,
          )
        } else {
          ShellChatVoiceRecorder.cancel(this)
          BlypShellChatDraft.saveVoiceRecording(this, conversationId)
        }
        voiceMode = 0
        hideVoiceBar()
      }
      2 -> {
        BlypShellChatDraft.saveVoicePreview(
          this,
          conversationId,
          voicePreview,
          voicePreviewMs,
        )
        BlypShellChatVoicePlayer.stop()
        voiceMode = 0
        hideVoiceBar()
      }
      else -> Unit
    }
  }

  private fun discardVoice() {
    window.decorView.removeCallbacks(voiceTicker)
    ShellChatVoiceRecorder.cancel(this)
    BlypShellChatVoicePlayer.stop()
    voicePreview?.delete()
    voicePreview = null
    voiceMode = 0
    voiceLocked = false
    voiceFingerDown = false
    voiceCancelArmed = false
    BlypShellChatDraft.clearVoice(this, conversationId)
    BlypShellChatVoiceDuck.leave(this)
    hideVoiceBar()
  }

  private fun openChatPaySheet() {
    fun showSheet() {
      if (isFinishing) return
      ShellChatPaySheetDialogFragment().show(supportFragmentManager, "chat_pay")
    }
    val ctx = applicationContext
    val peer = BlypShellNearbyScan.snapshot()
    if (peer != null && peer.displayName.isNotBlank() && !isOwnNearbyPeer(peer)) {
      val name = BlypShellPeerNames.cached(ctx, peer.accountId) ?: peer.displayName
      BlypShellPayRuntime.applyRecipient(
        ctx,
        BlypShellPayRuntime.RecipientOption(
          accountId = peer.accountId,
          name = name,
          phoneDigits = peer.phoneDigits,
          fromBle = true,
        ),
      )
      BlypShellQuickPayPref.mirrorRecipient(ctx, peer.accountId, name, peer.phoneDigits)
      showSheet()
      return
    }
    val nine = peerPhone.replace(Regex("\\D"), "").takeLast(9)
    if (nine.length >= 9) {
      BlypShellPayRecipient.resolvePhoneAsync(this, nine) {
        runOnUiThread { showSheet() }
      }
      return
    }
    showSheet()
  }

  private fun isOwnNearbyPeer(peer: BlypShellNearbyScan.Peer): Boolean {
    val mine = BlypShellSession.accountId(this)?.trim()?.uppercase().orEmpty()
    if (mine.isNotEmpty() && mine == peer.accountId.uppercase()) return true
    val phone = BlypShellSession.phone(this)?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty()
    return phone.length == 9 && phone == peer.phoneDigits
  }

  private fun paintNearbyMerchant(peer: BlypShellNearbyScan.Peer?) {
    val circle = findViewById<View>(R.id.blyp_chat_nearby_circle) ?: return
    val avatar = findViewById<ImageView>(R.id.blyp_chat_nearby_avatar)
    val initial = findViewById<TextView>(R.id.blyp_chat_nearby_initial)
    val name = findViewById<TextView>(R.id.blyp_chat_nearby_name)
    val phone = findViewById<TextView>(R.id.blyp_chat_nearby_phone)
    val label = findViewById<TextView>(R.id.blyp_chat_nearby_label)
    if (peer == null || peer.displayName.isBlank()) {
      avatar.visibility = View.GONE
      initial.visibility = View.VISIBLE
      initial.text = "?"
      circle.clipToOutline = false
      name.visibility = View.GONE
      phone.visibility = View.GONE
      label.visibility = View.VISIBLE
      return
    }
    label.visibility = View.GONE
    name.visibility = View.VISIBLE
    phone.visibility = View.VISIBLE
    val nine = peer.phoneDigits.filter { it.isDigit() }
    val shown =
      BlypShellPeerNames.cached(this, peer.accountId)?.trim().orEmpty().ifEmpty {
        peer.displayName.trim()
      }
    name.text = shown
    name.tag = peer.accountId
    BlypShellPeerNames.resolveAsync(this, peer.accountId) { resolved ->
      if (isFinishing) return@resolveAsync
      if (name.tag != peer.accountId) return@resolveAsync
      name.text = resolved
    }
    phone.text =
      if (nine.length >= 9) {
        "+237 ${nine.take(3)} ${nine.drop(3).take(3)} ${nine.drop(6)}"
      } else {
        nine
      }
    val letter =
      shown.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
    circle.clipToOutline = true
    circle.outlineProvider =
      object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
          outline.setOval(0, 0, view.width, view.height)
        }
      }
    avatar.clipToOutline = true
    initial.clipToOutline = true
    val avatarUrl = BlypShellPeerAvatar.urlForPhone(this, nine.ifEmpty { null })
    if (avatar.visibility == View.VISIBLE && !avatarUrl.isNullOrBlank()) {
      initial.visibility = View.GONE
      initial.text = ""
    } else {
      initial.text = letter
      initial.visibility = View.VISIBLE
      if (avatarUrl.isNullOrBlank()) avatar.visibility = View.GONE
    }
    BlypShellAvatarLoader.loadInto(avatarUrl, avatar, initial, letter)
  }

  private fun paintVoiceWave(recording: Boolean) {
    val wave = findViewById<BlypShellVoiceWaveView>(R.id.blyp_chat_voice_wave) ?: return
    if (!recording) return
    wave.colors(
      ContextCompat.getColor(this, R.color.blyp_shell_text),
      ContextCompat.getColor(this, R.color.blyp_shell_muted),
    )
    wave.pushLevel(ShellChatVoiceRecorder.level())
  }

  private fun showVoiceBar(recording: Boolean, locked: Boolean = false) {
    val field = findViewById<EditText>(R.id.blyp_chat_input)
    val wrap = findViewById<View>(R.id.blyp_chat_voice_wrap)
    wrap?.isFocusable = true
    wrap?.isFocusableInTouchMode = true
    wrap?.visibility = View.VISIBLE
    wrap?.requestFocus()
    field?.clearFocus()
    val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.hideSoftInputFromWindow(window.decorView.windowToken, 0)
    runCatching { findViewById<View>(R.id.blyp_chat_input_box)?.visibility = View.GONE }
    runCatching { findViewById<View>(R.id.blyp_chat_send_hit)?.visibility = View.GONE }
    findViewById<View>(R.id.blyp_chat_voice_delete)?.visibility = View.VISIBLE
    findViewById<View>(R.id.blyp_chat_voice_send)?.visibility = View.VISIBLE
    findViewById<View>(R.id.blyp_chat_voice_hint)?.visibility = View.VISIBLE
    ensureVoiceEffects()
    findViewById<View>(R.id.blyp_chat_voice_lock)?.visibility = View.GONE
    findViewById<View>(R.id.blyp_chat_voice_dot)?.visibility =
      if (recording) View.VISIBLE else View.GONE
    findViewById<View>(R.id.blyp_chat_voice_resume)?.visibility =
      if (recording) View.GONE else View.VISIBLE
    paintVoiceTransport()
    paintVoiceWave(recording)
    paintSend()
    paintTools()
  }

  private fun hideVoiceBar() {
    findViewById<View>(R.id.blyp_chat_voice_wrap)?.visibility = View.GONE
    findViewById<View>(R.id.blyp_chat_voice_resume)?.visibility = View.GONE
    findViewById<View>(R.id.blyp_chat_voice_lock)?.visibility = View.GONE
    findViewById<View>(R.id.blyp_chat_input_box)?.visibility = View.VISIBLE
    findViewById<View>(R.id.blyp_chat_send_hit)?.visibility = View.VISIBLE
    paintSend()
    paintTools()
  }

  private fun voiceClock(ms: Long): String {
    val total = (ms / 1000L).toInt().coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return "%02d:%02d:%02d".format(h, m, s)
  }

  private fun voiceFxChoices(): List<Pair<String, Int>> =
    listOf(
      "none" to R.string.blyp_shell_voice_fx_none,
      "high" to R.string.blyp_shell_voice_fx_high,
      "low" to R.string.blyp_shell_voice_fx_low,
      "robot" to R.string.blyp_shell_voice_fx_robot,
      "echo" to R.string.blyp_shell_voice_fx_echo,
      "radio" to R.string.blyp_shell_voice_fx_radio,
      "squirrel" to R.string.blyp_shell_voice_fx_squirrel,
      "cave" to R.string.blyp_shell_voice_fx_cave,
      "ghost" to R.string.blyp_shell_voice_fx_ghost,
      "phone" to R.string.blyp_shell_voice_fx_phone,
    )

  private fun ensureVoiceEffects() {
    val row = findViewById<LinearLayout>(R.id.blyp_chat_voice_effect_row) ?: return
    if (row.childCount == 0) {
      val d = resources.displayMetrics.density
      for ((id, label) in voiceFxChoices()) {
        val chip = TextView(this)
        chip.text = getString(label)
        chip.textSize = 13f
        chip.tag = id
        chip.setPadding((12 * d).toInt(), (6 * d).toInt(), (12 * d).toInt(), (6 * d).toInt())
        val lp =
          LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
          )
        lp.marginEnd = (8 * d).toInt()
        chip.setOnClickListener {
          voiceEffect = id
          paintVoiceEffects()
          bakePreview()
        }
        row.addView(chip, lp)
      }
    }
    paintVoiceEffects()
  }

  private fun paintVoiceEffects() {
    val row = findViewById<LinearLayout>(R.id.blyp_chat_voice_effect_row) ?: return
    val blue = ContextCompat.getColor(this, R.color.blyp_shell_voice_screen)
    for (i in 0 until row.childCount) {
      val chip = row.getChildAt(i) as? TextView ?: continue
      val on = chip.tag == voiceEffect
      chip.setTextColor(if (on) blue else android.graphics.Color.WHITE)
      chip.background =
        android.graphics.drawable.GradientDrawable().apply {
          cornerRadius = 40f
          setColor(if (on) android.graphics.Color.WHITE else 0x33FFFFFF)
        }
    }
  }

  private fun bakePreview() {
    if (voiceMode != 2) return
    val raw = voiceRaw ?: return
    val effect = voiceEffect
    BlypShellChatVoicePlayer.stop()
    if (effect == "none") {
      voicePreview = raw
      return
    }
    Thread {
      val out = BlypShellVoiceFx.apply(raw, effect)
      runOnUiThread {
        if (!isFinishing && voiceMode == 2 && voiceEffect == effect) voicePreview = out
      }
    }.start()
  }

  private fun deliverVoice(file: File, ms: Int) {
    val effect = voiceEffect
    if (effect == "none") {
      sendVoiceFile(file, ms)
      return
    }
    Thread {
      val out = BlypShellVoiceFx.apply(file, effect)
      val factor =
        when (effect) {
          "high" -> 1.45f
          "squirrel" -> 1.9f
          "low" -> 0.72f
          "cave" -> 0.82f
          else -> 1f
        }
      val duration = (ms / factor).toInt().coerceAtLeast(1)
      runOnUiThread {
        if (!isFinishing) sendVoiceFile(out, duration)
      }
    }.start()
  }

  private fun sendVoiceFile(file: File, durationMs: Int) {
    val phone = phone()
    val myId = myUserId()?.trim().orEmpty()
    if (phone.isEmpty() || myId.isEmpty()) {
      voiceSending = false
      hideSendSpinNow()
      return
    }
    val clientId = UUID.randomUUID().toString()
    if (!BlypShellChatOutbox.claimSend(clientId)) {
      voiceSending = false
      hideSendSpinNow()
      return
    }
    playSentSound()
    val optimistic =
      BlypShellChatMessagesStore.optimisticVoice(
        conversationId,
        myId,
        clientId,
        durationMs,
        file.absolutePath,
      )
    val local = BlypShellChatMessagesStore.loadRawObjects(this, phone, conversationId)
    BlypShellChatMessagesStore.saveMerged(
      this,
      phone,
      conversationId,
      BlypShellChatMessagesStore.mergeNetworkItems(local, listOf(optimistic)),
    )
    hideSendSpinNow()
    window.decorView.post {
      voiceSending = false
      if (!isFinishing) bindFromCache(scrollEnd = true)
    }
    val reply = replyToId
    BlypShellChatMediaSend.sendVoiceAsync(
      this,
      conversationId,
      file,
      durationMs,
      clientId,
      reply,
    ) { ok, msg ->
      BlypShellChatOutbox.finishSend(clientId, ok && msg != null)
      if (!ok || msg == null) {
        toast(getString(R.string.blyp_shell_chat_voice_failed))
        return@sendVoiceAsync
      }
      mergeServerMessage(phone, clientId, msg)
    }
  }

  private fun mergeServerMessage(phone: String, clientId: String, server: org.json.JSONObject) {
    val cur = BlypShellChatMessagesStore.loadRawObjects(this, phone, conversationId)
    val without =
      cur.filter { it.optString("id") != clientId && it.optString("clientId") != clientId }
    val after = BlypShellChatMessagesStore.mergeNetworkItems(without, listOf(server))
    BlypShellChatMessagesStore.saveMerged(this, phone, conversationId, after)
    bindFromCache(scrollEnd = true)
    BlypShellChatThreadPullGate.markPulled(conversationId)
  }

  private fun sendText() {
    if (sending) return
    val text = input.text.toString().trim()
    if (text.isEmpty()) return
    sendTyping(false)
    val phone = phone()
    val myId = myUserId()?.trim().orEmpty()
    if (phone.isEmpty() || myId.isEmpty()) {
      toast(getString(R.string.blyp_shell_chat_send_failed))
      return
    }
    playSentSound()
    val clientId = UUID.randomUUID().toString()
    val reply = replyToId
    input.setText("")
    BlypShellChatDraft.clearText(this, conversationId)
    clearReply()
    sending = true
    showSendSpin(clientId)
    val optimistic =
      BlypShellChatMessagesStore.optimisticText(conversationId, myId, text, clientId)
    if (!reply.isNullOrBlank()) optimistic.put("replyToMessageId", reply)
    Thread {
      BlypShellChatMessagesStore.upsertMessages(this, phone, conversationId, listOf(optimistic))
      BlypShellChatOutbox.send(this, phone, conversationId, text, clientId, reply) { ok ->
        sending = false
        if (isFinishing) return@send
        if (ok) BlypShellChatThreadPullGate.markPulled(conversationId)
      }
    }.start()
  }

  private fun showSendSpin(clientId: String, immediate: Boolean = false) {
    sendSpinId = clientId
    val spin = findViewById<View>(R.id.blyp_chat_send_spin) ?: return
    val icon = findViewById<View>(R.id.blyp_chat_send)
    spin.animate().cancel()
    spin.alpha = 1f
    spin.translationY = 0f
    spin.visibility = View.VISIBLE
    icon?.visibility = View.INVISIBLE
    if (immediate) return
    spin.alpha = 0f
    spin.translationY = 16f * resources.displayMetrics.density
    spin.animate()
      .translationY(0f)
      .alpha(1f)
      .setDuration(220)
      .setInterpolator(android.view.animation.DecelerateInterpolator(1.4f))
      .start()
  }

  private fun hideSendSpinNow() {
    sendSpinId = null
    val spin = findViewById<View>(R.id.blyp_chat_send_spin) ?: return
    spin.animate().cancel()
    spin.visibility = View.GONE
    spin.translationY = 0f
    spin.alpha = 1f
    findViewById<View>(R.id.blyp_chat_send)?.visibility = View.VISIBLE
  }

  private fun hideSendSpin() {
    if (sendSpinId == null) return
    sendSpinId = null
    val spin = findViewById<View>(R.id.blyp_chat_send_spin) ?: return
    if (spin.visibility != View.VISIBLE) return
    val dy = 16f * resources.displayMetrics.density
    spin.animate().cancel()
    spin.animate()
      .translationY(dy)
      .alpha(0f)
      .setDuration(180)
      .setInterpolator(android.view.animation.DecelerateInterpolator(1.4f))
      .withEndAction {
        spin.visibility = View.GONE
        spin.translationY = 0f
        spin.alpha = 1f
        findViewById<View>(R.id.blyp_chat_send)?.visibility = View.VISIBLE
      }
      .start()
  }

  private fun voiceChainAfter(row: ShellChatBubble): List<BlypShellChatVoicePlayer.ChainItem> {
    val idx = cached.indexOfFirst { it.id == row.id }
    if (idx < 0) return emptyList()
    val out = ArrayList<BlypShellChatVoicePlayer.ChainItem>()
    for (i in idx + 1 until cached.size) {
      val b = cached[i]
      if (b.deletedForAll || b.type != "voice") break
      out.add(
        BlypShellChatVoicePlayer.ChainItem(
          b.id,
          conversationId,
          b.voiceKey.orEmpty(),
          b.voiceLocalPath,
        ),
      )
    }
    return out
  }

  fun playVoiceChained(row: ShellChatBubble, onError: () -> Unit) {
    BlypShellChatVoicePlayer.playWithChain(
      this,
      conversationId,
      row.id,
      row.voiceKey.orEmpty(),
      row.voiceLocalPath,
      voiceChainAfter(row),
      {
        if (!isFinishing && ::adapter.isInitialized) adapter.notifyPlaybackChanged()
      },
      onError,
    )
  }

  private fun paintSend() {
    val send = findViewById<ImageView>(R.id.blyp_chat_send) ?: return
    val ready =
      voiceMode == 2 ||
        pendingPhotos.isNotEmpty() ||
        (::input.isInitialized && input.text?.toString()?.trim()?.isNotEmpty() == true)
    send.isEnabled = ready
    findViewById<View>(R.id.blyp_chat_send_hit)?.isEnabled = ready
    send.clearColorFilter()
    send.background?.mutate()?.setTint(
      ContextCompat.getColor(
        this,
        if (ready) R.color.blyp_shell_accent else R.color.blyp_shell_muted,
      ),
    )
  }

  private fun hideKeyboard() {
    val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
    imm.hideSoftInputFromWindow(input.windowToken, 0)
    input.clearFocus()
  }

  private fun showKeyboard() {
    window.setSoftInputMode(
      WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
        WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE,
    )
    input.requestFocus()
    val show = Runnable {
      val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
      imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }
    if (hasWindowFocus()) {
      input.post(show)
      return
    }
    window.decorView.viewTreeObserver.addOnWindowFocusChangeListener(
      object : ViewTreeObserver.OnWindowFocusChangeListener {
        override fun onWindowFocusChanged(hasFocus: Boolean) {
          if (!hasFocus) return
          window.decorView.viewTreeObserver.removeOnWindowFocusChangeListener(this)
          input.post(show)
        }
      },
    )
  }

  override fun finish() {
    super.finish()
    overridePendingTransition(R.anim.blyp_chat_pop_enter, R.anim.blyp_chat_pop_exit)
  }

  private fun toast(msg: String) {
    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
  }

  private fun applySystemBarAppearance() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  private class ChatAdapter(
    private val conversationId: String,
    private val onToast: (String) -> Unit,
    private val onLongPress: (ShellChatBubble, View) -> Unit,
    private val onMoneyAction: (ShellChatBubble) -> Unit,
    private val onReceiptToggle: (ShellChatBubble) -> Unit,
    private val claimingTransferId: () -> String?,
  ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    private var items: List<ShellChatBubble> = emptyList()
    private val albums = HashMap<String, List<ShellChatBubble>>()
    private val albumCount = HashMap<String, Int>()
    var peerReadAt: String? = null
    var localReadAt: String? = null
    private val arrivals = HashSet<String>()

    fun refresh(id: String) {
      val index = items.indexOfFirst { it.id == id }
      if (index >= 0) notifyItemChanged(index)
    }

    fun patchReactions(id: String, reactions: List<ShellChatReaction>) {
      val index = items.indexOfFirst { it.id == id }
      if (index < 0) return
      val cur = items[index]
      if (cur.reactions == reactions) {
        notifyItemChanged(index)
        return
      }
      val next = items.toMutableList()
      next[index] = cur.copy(reactions = reactions)
      items = next
      notifyItemChanged(index)
    }

    fun markArrivals(ids: Collection<String>) {
      arrivals.addAll(ids)
    }

    fun submit(next: List<ShellChatBubble>): String {
      val oldCounts = HashMap(albumCount)
      albums.clear()
      val collapsed = ArrayList<ShellChatBubble>()
      var i = 0
      while (i < next.size) {
        val row = next[i]
        if (row.type != "image" || row.deletedForAll) {
          collapsed.add(row)
          i += 1
          continue
        }
        val group = ArrayList<ShellChatBubble>()
        group.add(row)
        var j = i + 1
        while (j < next.size) {
          val n = next[j]
          if (n.type != "image" || n.deletedForAll || n.mine != row.mine) break
          if (!sameImageAlbum(row, group.last(), n)) break
          group.add(n)
          j += 1
        }
        if (group.size > 1) albums[row.id] = group
        collapsed.add(row)
        i = j
      }
      albumCount.clear()
      for ((id, group) in albums) albumCount[id] = group.size
      val prev = items
      val appended =
        prev.isNotEmpty() &&
          collapsed.size > prev.size &&
          collapsed.take(prev.size).map { it.id } == prev.map { it.id }
      val sameIds =
        collapsed.size == prev.size && collapsed.map { it.id } == prev.map { it.id }
      val nextIds = collapsed.map { it.id }
      val prevIds = prev.map { it.id }
      val removedIds = prevIds.filter { it !in nextIds.toSet() }
      val addedIds = nextIds.filter { it !in prevIds.toSet() }
      if (removedIds.size == 1 && addedIds.isEmpty()) {
        val pos = prevIds.indexOf(removedIds[0])
        items = collapsed
        if (pos >= 0) notifyItemRemoved(pos)
        return "remove"
      }
      items = collapsed
      return when {
        appended -> {
          notifyItemRangeInserted(prev.size, collapsed.size - prev.size)
          "append"
        }
        sameIds -> {
          for (i in collapsed.indices) {
            val id = collapsed[i].id
            if ((albumCount[id] ?: 0) != (oldCounts[id] ?: 0) || collapsed[i] != prev[i]) {
              notifyItemChanged(i)
            }
          }
          "same"
        }
        else -> {
          notifyDataSetChanged()
          "reset"
        }
      }
    }

    private fun sameImageAlbum(seed: ShellChatBubble, prev: ShellChatBubble, next: ShellChatBubble): Boolean {
      val a = seed.imageAlbumId?.trim().orEmpty()
      val b = next.imageAlbumId?.trim().orEmpty()
      if (a.isNotEmpty() && b.isNotEmpty()) return a == b
      if (a.isNotEmpty() || b.isNotEmpty()) return false
      return albumGapMs(prev.createdAt, next.createdAt) <= 2_500L
    }

    private fun albumGapMs(a: String, b: String): Long =
      try {
        kotlin.math.abs(
          java.time.Instant.parse(a).toEpochMilli() - java.time.Instant.parse(b).toEpochMilli(),
        )
      } catch (_: Exception) {
        0L
      }

    fun createdAtAt(position: Int): String? = items.getOrNull(position)?.createdAt

    fun notifyPlaybackChanged() {
      for (i in items.indices) {
        if (items[i].type == "voice") notifyItemChanged(i)
      }
    }

    fun notifyTranslations() {
      for (i in items.indices) {
        val type = items[i].type
        if (type == "text" || type == "money" || type == "image" || type == "document") {
          notifyItemChanged(i)
        }
      }
    }

    fun notifyMoneyRows() {
      for (i in items.indices) {
        if (items[i].type == "money") notifyItemChanged(i)
      }
    }

    override fun getItemViewType(position: Int): Int {
      val row = items[position]
      val image = row.type == "image" && !row.deletedForAll
      val voice = row.type == "voice" && !row.deletedForAll
      val doc = row.type == "document" && !row.deletedForAll
      val money = row.type == "money" && !row.deletedForAll
      val place = row.type == "place" && !row.deletedForAll
      return when {
        image && row.mine -> VIEW_IMG_MINE
        image && !row.mine -> VIEW_IMG_PEER
        voice && row.mine -> VIEW_VOICE_MINE
        voice && !row.mine -> VIEW_VOICE_PEER
        doc && row.mine -> VIEW_DOC_MINE
        doc && !row.mine -> VIEW_DOC_PEER
        money && row.mine -> VIEW_MONEY_MINE
        money && !row.mine -> VIEW_MONEY_PEER
        place && row.mine -> VIEW_PLACE_MINE
        place && !row.mine -> VIEW_PLACE_PEER
        row.mine -> VIEW_TEXT_MINE
        else -> VIEW_TEXT_PEER
      }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
      val inflater = LayoutInflater.from(parent.context)
      val layout =
        when (viewType) {
          VIEW_IMG_MINE -> R.layout.blyp_shell_chat_row_image_mine
          VIEW_IMG_PEER -> R.layout.blyp_shell_chat_row_image_peer
          VIEW_VOICE_MINE -> R.layout.blyp_shell_chat_row_voice_mine
          VIEW_VOICE_PEER -> R.layout.blyp_shell_chat_row_voice_peer
          VIEW_DOC_MINE -> R.layout.blyp_shell_chat_row_doc_mine
          VIEW_DOC_PEER -> R.layout.blyp_shell_chat_row_doc_peer
          VIEW_MONEY_MINE -> R.layout.blyp_shell_chat_row_money_mine
          VIEW_MONEY_PEER -> R.layout.blyp_shell_chat_row_money_peer
          VIEW_PLACE_MINE -> R.layout.blyp_shell_chat_row_place_mine
          VIEW_PLACE_PEER -> R.layout.blyp_shell_chat_row_place_peer
          VIEW_TEXT_MINE -> R.layout.blyp_shell_chat_row_mine
          else -> R.layout.blyp_shell_chat_row_peer
        }
      val v = inflater.inflate(layout, parent, false)
      return when (viewType) {
        VIEW_IMG_MINE, VIEW_IMG_PEER -> ImageHolder(v)
        VIEW_VOICE_MINE, VIEW_VOICE_PEER -> VoiceHolder(v)
        VIEW_DOC_MINE, VIEW_DOC_PEER -> DocumentHolder(v)
        VIEW_MONEY_MINE, VIEW_MONEY_PEER -> MoneyHolder(v)
        VIEW_PLACE_MINE, VIEW_PLACE_PEER -> PlaceHolder(v)
        else -> TextHolder(v)
      }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
      val row = items[position]
      bindStamp(holder.itemView, stampLabel(holder.itemView.context, items.getOrNull(position - 1), row))
      val view = holder.itemView
      val arrived = arrivals.remove(row.id)
      view.alpha = 1f
      view.scaleX = 1f
      view.scaleY = 1f
      view.translationX = 0f
      if (!arrived && view.translationY == 0f) view.animate().cancel()
      val ctx = view.context
      when (holder) {
        is TextHolder -> holder.bind(row, seenAt(row), arrived)
        is ImageHolder -> holder.bind(row, conversationId, seenAt(row), arrived)
        is VoiceHolder ->
          holder.bind(row, conversationId) {
            onToast(ctx.getString(R.string.blyp_shell_chat_voice_play_failed))
          }
        is DocumentHolder ->
          holder.bind(row, conversationId, onToast) {
            onToast(ctx.getString(R.string.blyp_shell_chat_document_open_failed))
          }
        is MoneyHolder ->
          holder.bind(
            row,
            claimingTransferId() == row.moneyTransferId,
            onMoneyAction,
            onReceiptToggle,
          )
        is PlaceHolder -> holder.bind(row)
      }
      holder.itemView.setOnLongClickListener {
        onLongPress(row, holder.itemView)
        true
      }
      holder.itemView.isClickable = false
    }

    override fun getItemCount(): Int = items.size

    private fun seenAt(row: ShellChatBubble): String? {
      if (!row.mine || row.outboundPending || row.deletedForAll) return null
      val cursor = peerReadAt ?: return null
      if (!BlypShellChatReceipts.seen(row.createdAt, cursor)) return null
      return cursor
    }

    class TextHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val body = itemView.findViewById<TextView>(R.id.blyp_chat_body)
      private val quote = itemView.findViewById<TextView>(R.id.blyp_chat_reply_quote)

      fun bind(row: ShellChatBubble, seenIso: String?, arrived: Boolean) {
        val ctx = itemView.context
        val reply = row.replySnippet?.trim().orEmpty()
        if (reply.isNotEmpty()) {
          quote.visibility = View.VISIBLE
          quote.text = reply
        } else {
          quote.visibility = View.GONE
        }
        val fwd =
          if (row.forwarded && !row.deletedForAll) {
            ctx.getString(R.string.blyp_shell_chat_forwarded) + "\n"
          } else {
            ""
          }
        val translated =
          if (!row.mine && row.type == "text") BlypShellChatTranslate.peek(row.id) else null
        body.text =
          when {
            row.deletedForAll -> ctx.getString(R.string.blyp_shell_chat_deleted)
            translated != null -> translated + "\n" + row.body
            row.type == "text" && row.body.isNotEmpty() -> fwd + row.body
            row.type == "image" -> fwd + ctx.getString(R.string.blyp_shell_chat_type_image)
            row.type == "document" -> fwd + ctx.getString(R.string.blyp_shell_chat_type_document)
            else -> fwd + ctx.getString(R.string.blyp_shell_chat_type_other)
          }
        val solo = !row.deletedForAll && soloEmoji(row.body)
        val d = ctx.resources.displayMetrics.density
        if (solo) {
          body.background = null
          body.textSize = 48f
          body.setPadding(0, 0, 0, 0)
        } else {
          body.setBackgroundResource(
            if (row.mine) R.drawable.blyp_shell_chat_bubble_mine
            else R.drawable.blyp_shell_chat_bubble_peer,
          )
          body.textSize = 17f
          val h = (14 * d).toInt()
          val v = (8 * d).toInt()
          body.setPadding(h, v, h, v)
        }
        body.setOnLongClickListener {
          (ctx as? ShellChatThreadActivity)?.onMessageLongPress(row, body)
          true
        }
        (ctx as? ShellChatThreadActivity)?.armDoubleTapHeart(body, row)
        if (arrived && solo) {
          body.translationY = 18f * d
          body.alpha = 0f
          body.scaleX = 0.72f
          body.scaleY = 0.72f
          body.rotation = -8f
          body.animate().cancel()
          body.animate().translationY(0f).alpha(1f).scaleX(1.08f).scaleY(1.08f).rotation(8f)
            .setDuration(220)
            .withEndAction {
              body.animate().rotation(-5f).scaleX(1f).scaleY(1f).setDuration(140).withEndAction {
                body.animate().rotation(0f).setDuration(120).start()
              }.start()
            }
            .start()
        } else if (!solo) {
          body.translationY = 0f
          body.scaleX = 1f
          body.scaleY = 1f
          body.rotation = 0f
        }
        bindSendMeta(itemView, row, seenIso)
        bindReactions(itemView, row)
      }

      private fun soloEmoji(raw: String): Boolean {
        val text = raw.trim()
        if (text.isEmpty() || text.length > 24) return false
        if (text.any { it.isLetterOrDigit() }) return false
        return text.any { !it.isWhitespace() }
      }
    }

    class MoneyHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val quote = itemView.findViewById<TextView>(R.id.blyp_chat_reply_quote)
      private val fruit = itemView.findViewById<TextView?>(R.id.blyp_chat_money_fruit)
      private val brand = itemView.findViewById<TextView?>(R.id.blyp_chat_money_brand)
      private val amount = itemView.findViewById<TextView>(R.id.blyp_chat_money_amount)
      private val caption = itemView.findViewById<TextView?>(R.id.blyp_chat_money_caption)
      private val status = itemView.findViewById<TextView>(R.id.blyp_chat_money_status)
      private val action = itemView.findViewById<TextView>(R.id.blyp_chat_money_action)
      private val receiptToggle =
        itemView.findViewById<TextView?>(R.id.blyp_chat_money_receipt_toggle)
      private val bubble = itemView.findViewById<View>(R.id.blyp_chat_money_bubble)

      fun bind(
        row: ShellChatBubble,
        claiming: Boolean,
        onAction: (ShellChatBubble) -> Unit,
        onReceiptToggle: (ShellChatBubble) -> Unit,
      ) {
        val ctx = itemView.context
        val reply = row.replySnippet?.trim().orEmpty()
        if (reply.isNotEmpty()) {
          quote.visibility = View.VISIBLE
          quote.text = reply
        } else {
          quote.visibility = View.GONE
        }
        val fruitEmoji =
          row.moneyFruitEmoji?.trim().orEmpty().let {
            if (it.equals("null", ignoreCase = true)) "" else it
          }
        val cashWidth = (220f * ctx.resources.displayMetrics.density).toInt()
        if (fruitEmoji.isNotEmpty() && fruit != null) {
          fruit.visibility = View.VISIBLE
          fruit.text = fruitEmoji
          fruit.textSize = 64f
          amount.visibility = View.GONE
          brand?.visibility = View.GONE
          bubble.background = null
          bubble.layoutParams.width = android.view.ViewGroup.LayoutParams.WRAP_CONTENT
        } else {
          fruit?.visibility = View.GONE
          brand?.visibility = View.VISIBLE
          bubble.setBackgroundResource(R.drawable.blyp_shell_cash_bubble)
          val ink = ContextCompat.getColor(ctx, R.color.blyp_shell_cash_text)
          brand?.setTextColor(ink)
          caption?.setTextColor(ink)
          bubble.layoutParams.width = cashWidth
          if (row.moneyAmountFcfa > 0) {
            amount.visibility = View.VISIBLE
            amount.text = cashAmount(row.moneyAmountFcfa)
            val dim =
              row.moneyStatus == "expired" ||
                row.moneyStatus == "cancelled" ||
                row.moneyStatus == "claimed"
            amount.setTextColor(
              ContextCompat.getColor(
                ctx,
                if (dim) R.color.blyp_shell_cash_muted else R.color.blyp_shell_cash_text,
              ),
            )
          } else {
            amount.visibility = View.GONE
          }
        }
        val note = row.body.trim()
        val noteOk = note.isNotEmpty() && note.filter { it.isDigit() } != row.moneyAmountFcfa.toString()
        val rawStatus = row.moneyStatus?.trim().orEmpty()
        val recalled =
          rawStatus == "claimed" &&
            !row.moneyClaimedByUserId.isNullOrEmpty() &&
            row.moneyClaimedByUserId == row.moneyFromUserId
        val hideMotif = rawStatus == "cancelled" || recalled
        val translatedNote =
          if (!row.mine && noteOk && !hideMotif) {
            BlypShellChatTranslate.peek(row.id + "::caption")
          } else {
            null
          }
        if (noteOk && caption != null && !hideMotif) {
          caption.visibility = View.VISIBLE
          caption.text = if (translatedNote != null) translatedNote + "\n" + note else note
        } else {
          caption?.visibility = View.GONE
        }
        status.text = moneyStatusLabel(ctx, row)
        status.setTextColor(
          ContextCompat.getColor(
            ctx,
            if (rawStatus == "claimed" && !recalled) {
              R.color.blyp_shell_cash_claimed
            } else {
              R.color.blyp_shell_cash_muted
            },
          ),
        )
        val host = ctx as? ShellChatThreadActivity
        val celebrate = host?.takeClaimCelebration(row) == true
        val settle = celebrate || host?.takeMoneySettle(row) == true
        bubble.alpha = if (claiming) 0.55f else 1f
        if (!settle && status.translationY == 0f) {
          status.animate().cancel()
          status.alpha = 1f
        }
        if (row.canMoneyAction()) {
          action.visibility = View.VISIBLE
          action.text =
            ctx.getString(
              if (row.mine) {
                R.string.blyp_shell_chat_money_edit
              } else {
                R.string.blyp_shell_chat_money_claim
              },
            )
          action.alpha = 1f
          action.scaleX = 1f
          action.scaleY = 1f
        } else if (settle && action.visibility == View.VISIBLE) {
          action.animate().cancel()
          action.animate().alpha(0f).scaleX(0.94f).scaleY(0.94f).setDuration(420).withEndAction {
            action.visibility = View.GONE
            action.alpha = 1f
            action.scaleX = 1f
            action.scaleY = 1f
          }.start()
        } else {
          action.animate().cancel()
          action.alpha = 1f
          action.translationY = 0f
          action.visibility = View.GONE
        }
        if (settle) settleMoney(ctx, celebrate)
        val toggle = receiptToggle
        if (
          toggle != null &&
            row.mine &&
            row.moneyReceiptRequired &&
            row.moneyStatus == "pending" &&
            row.moneyFruitEmoji.isNullOrEmpty() &&
            !row.moneyTransferId.isNullOrEmpty()
        ) {
          toggle.visibility = View.VISIBLE
          toggle.text = ctx.getString(R.string.blyp_shell_money_receipt_on)
        } else {
          toggle?.visibility = View.GONE
        }
        bubble.setOnClickListener(null)
        bubble.isClickable = false
        val showTime = View.OnClickListener {
          (ctx as? ShellChatThreadActivity)?.toggleMeta(row.id)
        }
        status.setOnClickListener(showTime)
        brand?.setOnClickListener(showTime)
        caption?.setOnClickListener(showTime)
        fruit?.setOnClickListener(showTime)
        if (amount.visibility == View.VISIBLE) amount.setOnClickListener(showTime)
        if (row.canMoneyAction()) {
          action.setOnClickListener { v ->
            v.performHapticFeedback(android.view.HapticFeedbackConstants.CONTEXT_CLICK)
            if (!claiming) onAction(row)
          }
        } else {
          action.setOnClickListener(null)
        }
        if (receiptToggle?.visibility == View.VISIBLE) {
          receiptToggle.setOnClickListener { v ->
            v.performHapticFeedback(android.view.HapticFeedbackConstants.CONTEXT_CLICK)
            if (!claiming) onReceiptToggle(row)
          }
        } else {
          receiptToggle?.setOnClickListener(null)
        }
        bindSendMeta(itemView, row, null)
        if (row.outboundPending) {
          itemView.findViewById<TextView?>(R.id.blyp_chat_time)?.visibility = View.GONE
        }
        bindReactions(itemView, row)
      }

      private fun settleMoney(ctx: Context, confetti: Boolean) {
        val d = ctx.resources.displayMetrics.density
        val ease = android.view.animation.DecelerateInterpolator(2.4f)
        val muted = ContextCompat.getColor(ctx, R.color.blyp_shell_cash_muted)
        if (amount.visibility == View.VISIBLE) {
          android.animation.ValueAnimator.ofArgb(amount.currentTextColor, muted).apply {
            duration = 560
            interpolator = ease
            addUpdateListener { amount.setTextColor(it.animatedValue as Int) }
            start()
          }
        }
        status.animate().cancel()
        status.translationY = 12f * d
        status.alpha = 0f
        status.animate()
          .translationY(0f)
          .alpha(1f)
          .setStartDelay(140)
          .setDuration(520)
          .setInterpolator(ease)
          .start()
        if (confetti) {
          itemView.findViewById<BlypShellCashGraffitiView>(R.id.blyp_chat_money_graffiti)?.play()
        }
      }

      private fun cashAmount(fcfa: Int): String {
        val grouped =
          java.text.NumberFormat.getIntegerInstance(java.util.Locale.getDefault()).format(fcfa)
        return "$grouped F"
      }

      private fun moneyStatusLabel(ctx: Context, row: ShellChatBubble): String {
        if (row.outboundPending) {
          return ctx.getString(BlypShellChatOutbox.pendingLabel(row.clientId))
        }
        val raw = row.moneyStatus?.trim().orEmpty()
        val recalled =
          raw == "claimed" &&
            !row.moneyClaimedByUserId.isNullOrEmpty() &&
            row.moneyClaimedByUserId == row.moneyFromUserId
        val peer =
          (ctx as? android.app.Activity)
            ?.findViewById<TextView>(R.id.blyp_chat_title)
            ?.text
            ?.toString()
            ?.trim()
            ?.substringBefore(' ')
            .orEmpty()
            .ifEmpty { "…" }
        val main =
          when {
            raw == "cancelled" -> ctx.getString(R.string.blyp_shell_chat_money_status_cancelled)
            recalled && row.mine -> ctx.getString(R.string.blyp_shell_chat_money_status_recalled)
            recalled -> ctx.getString(R.string.blyp_shell_chat_money_status_recalled_by, peer)
            raw == "claimed" && !row.mine ->
              ctx.getString(R.string.blyp_shell_chat_money_status_claimed)
            raw == "claimed" -> ctx.getString(R.string.blyp_shell_chat_money_status_claimed_by, peer)
            raw == "expired" -> ctx.getString(R.string.blyp_shell_chat_money_status_expired)
            else -> ctx.getString(R.string.blyp_shell_chat_money_status_pending)
          }
        val extra = ArrayList<String>()
        val exp = row.moneyExpiresAt
        if (raw == "pending" && !exp.isNullOrBlank()) {
          try {
            val whenAt = java.time.Instant.parse(exp).atZone(java.time.ZoneId.systemDefault())
            if (whenAt.isAfter(java.time.ZonedDateTime.now())) {
              val date =
                java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.getDefault())
                  .format(whenAt)
              extra.add(ctx.getString(R.string.blyp_shell_chat_money_expires, date))
            }
          } catch (_: Exception) {
          }
        }
        if (!row.moneyThanksName.isNullOrBlank()) {
          extra.add(
            if (!row.mine) ctx.getString(R.string.blyp_shell_chat_money_thanks_me)
            else ctx.getString(R.string.blyp_shell_chat_money_thanks_by, peer),
          )
        }
        return if (extra.isEmpty()) main else main + "\n" + extra.joinToString("\n")
      }
    }

    class PlaceHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val map = itemView.findViewById<ImageView>(R.id.blyp_chat_place_map)
      private val title = itemView.findViewById<TextView>(R.id.blyp_chat_place_title)
      private val note = itemView.findViewById<TextView>(R.id.blyp_chat_place_note)
      private val status = itemView.findViewById<TextView>(R.id.blyp_chat_place_status)
      private val action = itemView.findViewById<TextView>(R.id.blyp_chat_place_action)
      private val bubble = itemView.findViewById<View>(R.id.blyp_chat_place_bubble)

      fun bind(row: ShellChatBubble) {
        val ctx = itemView.context
        val place = BlypShellPlaceCodec.parsePlaceBody(row.body) ?: return
        BlypShellPlaceMapLoader.bind(map, place.lat, place.lng)
        val placeName = BlypShellPlaceName.sanitize(place.name)
        val placeNote = place.note.trim()
        title.text =
          placeName.ifEmpty { ctx.getString(R.string.blyp_shell_chat_place_here) }
        if (placeNote.isNotEmpty()) {
          note.visibility = View.VISIBLE
          note.text = placeNote
        } else {
          note.visibility = View.GONE
          note.text = ""
        }
        val leftMs = (place.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(0L)
        val leftMin = ((leftMs + 59_999L) / 60_000L).toInt()
        status.text =
          when {
            place.fixed ->
              if (placeName.isNotEmpty()) ctx.getString(R.string.blyp_shell_chat_place_here)
              else ctx.getString(R.string.blyp_shell_chat_place_fixed_status)
            place.stopped || leftMs <= 0L -> ctx.getString(R.string.blyp_shell_chat_place_ended)
            leftMin <= 1 -> ctx.getString(R.string.blyp_shell_chat_place_live_soon)
            else -> ctx.getString(R.string.blyp_shell_chat_place_live, leftMin)
          }
        status.visibility = View.VISIBLE
        val density = ctx.resources.displayMetrics.density
        val statusLp = status.layoutParams as? ViewGroup.MarginLayoutParams
        val bottomPad =
          if (row.mine && place.live) (4 * density).toInt() else (12 * density).toInt()
        status.setPadding(
          status.paddingLeft,
          status.paddingTop,
          status.paddingRight,
          bottomPad,
        )
        statusLp?.let { status.layoutParams = it }
        val canStop = row.mine && place.live
        if (canStop) {
          action.visibility = View.VISIBLE
          action.text = ctx.getString(R.string.blyp_shell_chat_place_stop)
          action.setOnClickListener {
            (ctx as? ShellChatThreadActivity)?.stopPlaceShare(place.sessionId)
          }
        } else {
          action.visibility = View.GONE
          action.setOnClickListener(null)
        }
        val open = View.OnClickListener {
          (ctx as? ShellChatThreadActivity)?.openPlaceMaps(place.lat, place.lng, placeName)
        }
        bubble.setOnClickListener(open)
        map.setOnClickListener(open)
        title.setOnClickListener(open)
        note.setOnClickListener(open)
        status.setOnClickListener(open)
        val longPress =
          View.OnLongClickListener {
            (ctx as? ShellChatThreadActivity)?.onMessageLongPress(row, bubble)
            true
          }
        bubble.setOnLongClickListener(longPress)
        map.setOnLongClickListener(longPress)
        bindSendMeta(itemView, row, null)
        bindReactions(itemView, row)
      }
    }

    class VoiceHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val quote = itemView.findViewById<TextView>(R.id.blyp_chat_reply_quote)
      private val play = itemView.findViewById<ImageView>(R.id.blyp_chat_voice_play)
      private val speed = itemView.findViewById<TextView>(R.id.blyp_chat_voice_speed)
      private val duration = itemView.findViewById<TextView>(R.id.blyp_chat_voice_duration)
      private val bubble = itemView.findViewById<View>(R.id.blyp_chat_voice_bubble)
      private val wave = itemView.findViewById<BlypShellVoiceWaveView>(R.id.blyp_chat_voice_wave_bars)
      private var scrubbing = false

      fun bind(row: ShellChatBubble, conversationId: String, onError: () -> Unit) {
        val ctx = itemView.context
        itemView.tag = row.id
        val reply = row.replySnippet?.trim().orEmpty()
        if (reply.isNotEmpty()) {
          quote.visibility = View.VISIBLE
          quote.text = reply
        } else {
          quote.visibility = View.GONE
        }
        val totalMs = row.voiceDurationMs.coerceAtLeast(0)
        val d = ctx.resources.displayMetrics.density
        val seconds = (totalMs / 1000f).coerceIn(1f, 45f)
        val waveW = ((108f + (seconds - 1f) / 44f * 100f) * d).toInt()
        val lp = wave.layoutParams
        if (lp.width != waveW) {
          lp.width = waveW
          wave.layoutParams = lp
        }
        val full =
          ContextCompat.getColor(
            ctx,
            if (row.mine) R.color.blyp_shell_bubble_mine_text else R.color.blyp_shell_bubble_peer_text,
          )
        val dim = android.graphics.Color.argb(90, android.graphics.Color.red(full), android.graphics.Color.green(full), android.graphics.Color.blue(full))
        wave.colors(full, dim)
        wave.seed(row.id)
        play.background = null
        play.setColorFilter(full)
        val rate = BlypShellChatVoicePlayer.rateFor(row.id)
        val rateLabel =
          when {
            rate >= 1.75f -> ctx.getString(R.string.blyp_shell_chat_voice_rate_2)
            rate >= 1.25f -> ctx.getString(R.string.blyp_shell_chat_voice_rate_15)
            else -> ctx.getString(R.string.blyp_shell_chat_voice_rate_1)
          }
        speed?.text = rateLabel
        speed?.contentDescription =
          ctx.getString(R.string.blyp_shell_chat_voice_speed_a11y, rateLabel)
        speed?.setOnClickListener {
          BlypShellChatVoicePlayer.cycleRate(row.id)
          (ctx as? ShellChatThreadActivity)?.adapter?.notifyPlaybackChanged()
        }
        val active = BlypShellChatVoicePlayer.activeId() == row.id
        val playing = BlypShellChatVoicePlayer.isPlaying(row.id)
        val pos = if (active) BlypShellChatVoicePlayer.positionMs() else 0
        val showPos = active && pos > 0
        paintFace(playing, if (showPos) pos else totalMs, totalMs, showPos)
        val key = row.voiceKey?.trim().orEmpty()
        val local = row.voiceLocalPath?.trim().orEmpty()
        if (local.isEmpty() || !java.io.File(local).isFile) {
          BlypShellChatVoicePlayer.prefetch(ctx, conversationId, key)
        }
        if (active) {
          BlypShellChatVoicePlayer.setProgressListener { id, at, dur, on, _ ->
            if (itemView.tag != id || scrubbing) return@setProgressListener
            val span = if (dur > 0) dur else totalMs
            paintFace(on, if (on || at > 0) at else totalMs, span, on || at > 0)
          }
        }
        val toggle = {
          val act = ctx as? ShellChatThreadActivity
          when {
            act == null ->
              BlypShellChatVoicePlayer.toggle(ctx, conversationId, row.id, key, local, onError)
            BlypShellChatVoicePlayer.isPlaying(row.id) -> {
              BlypShellChatVoicePlayer.stop()
              act.adapter.notifyPlaybackChanged()
            }
            BlypShellChatVoicePlayer.canResume(row.id) -> {
              BlypShellChatVoicePlayer.resumePlayback()
              act.adapter.notifyPlaybackChanged()
            }
            else -> act.playVoiceChained(row, onError)
          }
        }
        bubble.setOnClickListener {
          (ctx as? ShellChatThreadActivity)?.toggleMeta(row.id)
        }
        play.setOnClickListener { toggle() }
        wave.setOnTouchListener { v, event ->
          val frac = (event.x / v.width.coerceAtLeast(1)).coerceIn(0f, 1f)
          when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
              scrubbing = false
              v.tag = event.x
              true
            }
            MotionEvent.ACTION_MOVE -> {
              val start = (v.tag as? Float) ?: event.x
              if (kotlin.math.abs(event.x - start) > 8f * d) {
                scrubbing = true
                wave.setFraction(frac, true)
                duration.text = voiceClock((frac * totalMs).toInt())
              }
              true
            }
            MotionEvent.ACTION_UP -> {
              if (scrubbing && totalMs > 0 && BlypShellChatVoicePlayer.activeId() == row.id) {
                BlypShellChatVoicePlayer.seekTo((frac * totalMs).toInt())
              } else if (!scrubbing) {
                (ctx as? ShellChatThreadActivity)?.toggleMeta(row.id)
              }
              scrubbing = false
              true
            }
            else -> false
          }
        }
        bindSendMeta(itemView, row, null)
        bindReactions(itemView, row)
      }

      private fun paintFace(playing: Boolean, shownMs: Int, spanMs: Int, dimTail: Boolean) {
        play.setImageResource(
          if (playing) R.drawable.blyp_shell_voice_pause else R.drawable.blyp_shell_voice_play,
        )
        duration.text = voiceClock(if (dimTail) shownMs else spanMs)
        val p = if (spanMs > 0 && dimTail) shownMs.toFloat() / spanMs else 0f
        wave.setFraction(p, true)
      }

      private fun voiceClock(ms: Int): String {
        val total = (ms / 1000).coerceAtLeast(0)
        return "%d:%02d".format(total / 60, total % 60)
      }
    }

    class DocumentHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val quote = itemView.findViewById<TextView>(R.id.blyp_chat_reply_quote)
      private val name = itemView.findViewById<TextView>(R.id.blyp_chat_doc_name)
      private val meta = itemView.findViewById<TextView>(R.id.blyp_chat_doc_meta)
      private val progress = itemView.findViewById<android.widget.ProgressBar>(R.id.blyp_chat_doc_progress)
      private val bubble = itemView.findViewById<View>(R.id.blyp_chat_doc_bubble)
      private val videoBox = itemView.findViewById<View>(R.id.blyp_chat_video_box)
      private val videoThumb = itemView.findViewById<ImageView>(R.id.blyp_chat_video_thumb)
      private var downloading = false

      fun bind(
        row: ShellChatBubble,
        conversationId: String,
        onToast: (String) -> Unit,
        onError: () -> Unit,
      ) {
        val ctx = itemView.context
        if (bubble.tag != row.id) {
          downloading = false
          bubble.tag = row.id
        }
        val reply = row.replySnippet?.trim().orEmpty()
        if (reply.isNotEmpty()) {
          quote.visibility = View.VISIBLE
          quote.text = reply
        } else {
          quote.visibility = View.GONE
        }
        val fileName =
          row.documentFileName?.trim().orEmpty().ifEmpty {
            ctx.getString(R.string.blyp_shell_chat_type_document)
          }
        val video = isVideo(row.documentContentType, fileName)
        name.text = fileName
        val size = BlypShellFormat.fileSize(row.documentSizeBytes)
        meta.text = if (size.isNotEmpty()) size else " "
        progress.visibility = if (downloading && !video) View.VISIBLE else View.GONE
        val key = row.documentKey.orEmpty()
        val localDoc = row.documentLocalPath?.trim().orEmpty()
        if (video) {
          bubble.visibility = View.GONE
          videoBox?.visibility = View.VISIBLE
          paintVideoThumb(localDoc, row.id)
          videoBox?.setOnClickListener {
            val act = ctx as? ShellChatThreadActivity
            if (act?.isMetaShown(row.id) != true) {
              act?.toggleMeta(row.id)
              return@setOnClickListener
            }
            if (downloading) return@setOnClickListener
            val localFile = if (localDoc.isNotEmpty()) java.io.File(localDoc) else null
            if (localFile != null && localFile.isFile) {
              ShellChatVideoActivity.start(ctx, localFile.absolutePath)
              return@setOnClickListener
            }
            if (key.isEmpty()) {
              onError()
              return@setOnClickListener
            }
            downloading = true
            BlypShellChatDocumentOpen.ensureLocalAsync(ctx, conversationId, key, fileName) { file ->
              downloading = false
              if (file == null) onError() else ShellChatVideoActivity.start(ctx, file.absolutePath)
            }
          }
          bindSendMeta(itemView, row, null)
          bindReactions(itemView, row)
          return
        }
        videoBox?.visibility = View.GONE
        bubble.visibility = View.VISIBLE
        bubble.setOnClickListener {
          val act = ctx as? ShellChatThreadActivity
          if (act?.isMetaShown(row.id) != true) {
            act?.toggleMeta(row.id)
            return@setOnClickListener
          }
          if (downloading) return@setOnClickListener
          val localFile = if (localDoc.isNotEmpty()) java.io.File(localDoc) else null
          if (localFile != null && localFile.isFile) {
            val opened =
              BlypShellFileOpener.openLocalFile(ctx, localFile, row.documentContentType)
            if (!opened) onError()
            return@setOnClickListener
          }
          if (key.isEmpty()) {
            onError()
            return@setOnClickListener
          }
          downloading = true
          progress.visibility = View.VISIBLE
          onToast(ctx.getString(R.string.blyp_shell_chat_document_downloading))
          BlypShellChatDocumentOpen.openAsync(
            ctx,
            conversationId,
            key,
            fileName,
            row.documentContentType,
          ) { ok ->
            downloading = false
            progress.visibility = View.GONE
            if (!ok) onError()
          }
        }
        bindSendMeta(itemView, row, null)
        bindReactions(itemView, row)
      }

      private fun isVideo(type: String?, name: String): Boolean {
        val t = type?.lowercase().orEmpty()
        if (t.startsWith("video/")) return true
        val n = name.lowercase()
        return n.endsWith(".mp4") ||
          n.endsWith(".mov") ||
          n.endsWith(".webm") ||
          n.endsWith(".3gp") ||
          n.endsWith(".mkv")
      }

      private fun paintVideoThumb(path: String, rowId: String) {
        val image = videoThumb ?: return
        val file = java.io.File(path)
        if (!file.isFile) {
          image.setImageDrawable(null)
          return
        }
        image.tag = rowId
        Thread {
            val bmp =
              try {
                val meta = android.media.MediaMetadataRetriever()
                meta.setDataSource(file.absolutePath)
                val frame = meta.getFrameAtTime(0)
                meta.release()
                frame
              } catch (_: Exception) {
                null
              }
            image.post {
              if (image.tag != rowId || bmp == null) return@post
              image.setImageBitmap(bmp)
            }
          }
          .start()
      }
    }

    inner class ImageHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
      private val strip = itemView.findViewById<RecyclerView>(R.id.blyp_chat_image_strip)
      private val caption = itemView.findViewById<TextView>(R.id.blyp_chat_caption)

      init {
        strip.layoutManager =
          LinearLayoutManager(itemView.context, LinearLayoutManager.VERTICAL, false)
        strip.itemAnimator = null
        strip.isNestedScrollingEnabled = false
        strip.setItemViewCacheSize(4)
      }

      fun bind(row: ShellChatBubble, conversationId: String, seenIso: String?, arrived: Boolean) {
        val group = albums[row.id] ?: listOf(row)
        for (photo in group) {
          val known =
            BlypShellChatImageLoader.peek(photo.imageKey)
              ?: BlypShellChatImageLoader.peek(photo.imageThumbKey)
              ?: BlypShellChatImageLoader.peek(photo.localImagePath)
          if (known == null) {
            val app = itemView.context.applicationContext
            Thread {
                BlypShellChatImageLoader.decodeBest(
                  app,
                  conversationId,
                  photo.imageThumbKey?.trim().orEmpty().ifEmpty { photo.imageKey.orEmpty() },
                  photo.localImagePath,
                )
              }
              .start()
          }
        }
        val d = itemView.resources.displayMetrics.density
        val screen = itemView.resources.displayMetrics.widthPixels
        val grid = group.size > 1
        val w = (screen - (72 * d)).toInt().coerceAtMost((300 * d).toInt())
        val gap = (3 * d).toInt()
        val h =
          if (!grid) {
            val photo = group.first()
            val aspect =
              if (photo.imageWidth > 0 && photo.imageHeight > 0) {
                photo.imageHeight.toFloat() / photo.imageWidth
              } else {
                0.75f
              }
            (w * aspect).toInt().coerceIn((150 * d).toInt(), (340 * d).toInt())
          } else {
            collageHeight(group.size, w, gap)
          }
        val lp = strip.layoutParams
        if (lp.width != w || lp.height != h) {
          lp.width = w
          lp.height = h
          strip.layoutParams = lp
        }
        val wantCollage = grid
        if (wantCollage && strip.layoutManager !is CollageLayout) {
          strip.layoutManager = CollageLayout(gap)
        } else if (!wantCollage && strip.layoutManager !is LinearLayoutManager) {
          strip.layoutManager =
            LinearLayoutManager(itemView.context, LinearLayoutManager.VERTICAL, false)
        }
        if (grid) {
          strip.outlineProvider =
            object : ViewOutlineProvider() {
              override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, 16 * d)
              }
            }
          strip.clipToOutline = true
        } else {
          strip.clipToOutline = false
        }
        val current = strip.adapter as? AlbumStrip
        if (current == null || current.conversationId != conversationId) {
          val created = AlbumStrip(conversationId, group, d, arrived)
          strip.adapter = created
        } else {
          current.update(group, d, arrived)
        }
        val cap =
          group.firstNotNullOfOrNull { photo ->
            photo.body.trim().let { if (it.equals("null", ignoreCase = true)) "" else it }
              .takeIf { it.isNotEmpty() }
          }.orEmpty()
        if (cap.isNotEmpty()) {
          caption.visibility = View.VISIBLE
          caption.text = cap
        } else {
          caption.visibility = View.GONE
        }
        caption.setOnClickListener {
          (itemView.context as? ShellChatThreadActivity)?.toggleMeta(row.id)
        }
        strip.setOnClickListener {
          openPhotos(itemView.context, conversationId, group, 0)
        }
        bindSendMeta(itemView, group.last(), seenIso)
        val shown =
          if (group.size <= 1) row
          else row.copy(reactions = group.flatMap { it.reactions })
        bindReactions(itemView, shown)
      }
    }

    private fun collageHeight(count: Int, width: Int, gap: Int): Int {
      if (count > 4) {
        val top = (width * 0.56f).toInt()
        val bot = (width * 0.36f).toInt()
        return top + gap + bot
      }
      return when (count.coerceAtMost(4)) {
        2 -> ((width - gap) / 2f * 1.28f).toInt()
        3 -> {
          val top = (width * 0.58f).toInt()
          val bot = (width - gap) / 2
          top + gap + bot
        }
        else -> width
      }
    }

    private class CollageLayout(private val gap: Int) : RecyclerView.LayoutManager() {
      override fun generateDefaultLayoutParams(): RecyclerView.LayoutParams =
        RecyclerView.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        )

      override fun canScrollVertically(): Boolean = false

      override fun canScrollHorizontally(): Boolean = false

      override fun isAutoMeasureEnabled(): Boolean = false

      override fun onLayoutChildren(recycler: RecyclerView.Recycler, state: RecyclerView.State) {
        detachAndScrapAttachedViews(recycler)
        if (itemCount == 0 || width <= 0 || height <= 0) return
        val n = itemCount.coerceAtMost(5)
        for (i in 0 until n) {
          val view = recycler.getViewForPosition(i)
          addView(view)
          val cell = cell(i, n, width, height, gap)
          val specs =
            Pair(
              View.MeasureSpec.makeMeasureSpec(cell.width(), View.MeasureSpec.EXACTLY),
              View.MeasureSpec.makeMeasureSpec(cell.height(), View.MeasureSpec.EXACTLY),
            )
          view.measure(specs.first, specs.second)
          layoutDecorated(view, cell.left, cell.top, cell.right, cell.bottom)
        }
      }

      private fun cell(i: Int, n: Int, w: Int, h: Int, gap: Int): android.graphics.Rect {
        return when (n) {
          2 -> {
            val cw = (w - gap) / 2
            if (i == 0) android.graphics.Rect(0, 0, cw, h) else android.graphics.Rect(cw + gap, 0, w, h)
          }
          3 -> {
            val top = (w * 0.58f).toInt().coerceAtMost(h - gap)
            val cw = (w - gap) / 2
            when (i) {
              0 -> android.graphics.Rect(0, 0, w, top)
              1 -> android.graphics.Rect(0, top + gap, cw, h)
              else -> android.graphics.Rect(cw + gap, top + gap, w, h)
            }
          }
          5 -> {
            val topH = (h * 0.58f).toInt().coerceAtLeast(1)
            val botH = (h - gap - topH).coerceAtLeast(1)
            val colW = (w - gap * 2) / 3
            when (i) {
              0 -> android.graphics.Rect(0, 0, (w - gap) / 2, topH)
              1 -> android.graphics.Rect((w + gap) / 2, 0, w, topH)
              2 -> android.graphics.Rect(0, topH + gap, colW, topH + gap + botH)
              3 -> android.graphics.Rect(colW + gap, topH + gap, colW * 2 + gap, topH + gap + botH)
              else -> android.graphics.Rect(colW * 2 + gap * 2, topH + gap, w, topH + gap + botH)
            }
          }
          else -> {
            val cw = (w - gap) / 2
            val ch = (h - gap) / 2
            val col = i % 2
            val row = i / 2
            val left = if (col == 0) 0 else cw + gap
            val top = if (row == 0) 0 else ch + gap
            android.graphics.Rect(left, top, if (col == 0) cw else w, if (row == 0) ch else h)
          }
        }
      }
    }

    private class AlbumStrip(
      val conversationId: String,
      private var group: List<ShellChatBubble>,
      private var density: Float,
      private var arrived: Boolean,
    ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
      fun update(next: List<ShellChatBubble>, d: Float, justArrived: Boolean) {
        val same =
          density == d &&
            group.size == next.size &&
            group.zip(next).all { (a, b) -> a.id == b.id && a.localImagePath == b.localImagePath }
        group = next
        density = d
        if (justArrived) arrived = true
        if (!same) notifyDataSetChanged()
      }

      override fun getItemCount(): Int =
        when {
          group.size <= 1 -> group.size
          group.size > 4 -> 5
          else -> group.size
        }

      override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context)
        image.scaleType = ImageView.ScaleType.CENTER_CROP
        image.setBackgroundColor(
          ContextCompat.getColor(parent.context, R.color.blyp_shell_input_bg),
        )
        frame.addView(
          image,
          FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
          ),
        )
        val badge = TextView(parent.context)
        badge.setTextColor(0xFFFFFFFF.toInt())
        badge.textSize = 28f
        badge.gravity = Gravity.CENTER
        badge.setTypeface(badge.typeface, android.graphics.Typeface.BOLD)
        badge.setShadowLayer(8f, 0f, 1f, 0xCC000000.toInt())
        badge.visibility = View.GONE
        frame.addView(
          badge,
          FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
          ),
        )
        val spin = android.widget.ProgressBar(parent.context)
        spin.isIndeterminate = true
        spin.indeterminateTintList =
          android.content.res.ColorStateList.valueOf(
            ContextCompat.getColor(parent.context, R.color.blyp_shell_accent),
          )
        val spinSize = (32 * density).toInt()
        frame.addView(
          spin,
          FrameLayout.LayoutParams(spinSize, spinSize, Gravity.CENTER),
        )
        frame.outlineProvider =
          object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
              outline.setRoundRect(0, 0, view.width, view.height, 22 * density)
            }
          }
        frame.clipToOutline = true
        return object : RecyclerView.ViewHolder(frame) {}
      }

      private fun photoHeight(photo: ShellChatBubble, width: Int, density: Float): Int {
        val aspect =
          if (photo.imageWidth > 0 && photo.imageHeight > 0) {
            photo.imageHeight.toFloat() / photo.imageWidth
          } else {
            0.75f
          }
        return (width * aspect).toInt().coerceIn((150 * density).toInt(), (340 * density).toInt())
      }

      override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val photo = group[position]
        val frame = holder.itemView as FrameLayout
        val image = frame.getChildAt(0) as ImageView
        val badge = frame.getChildAt(1) as TextView
        val spin = frame.getChildAt(2)
        badge.visibility = View.GONE
        val grid = (frame.parent as? RecyclerView)?.layoutManager is CollageLayout
        val more = grid && position == itemCount - 1 && group.size > 5
        if (grid) {
          frame.layoutParams =
            RecyclerView.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT,
              ViewGroup.LayoutParams.MATCH_PARENT,
            )
          frame.clipToOutline = false
        } else {
          val w = (frame.parent as? View)?.width?.takeIf { it > 0 }
            ?: (holder.itemView.resources.displayMetrics.widthPixels - (64 * density).toInt())
          val h = photoHeight(photo, w, density)
          frame.layoutParams =
            RecyclerView.LayoutParams(w, h).apply {
              bottomMargin = (3 * density).toInt()
            }
          frame.clipToOutline = true
        }
        if (more) {
          badge.visibility = View.VISIBLE
          badge.text = "+${group.size - itemCount}"
          image.alpha = 0.55f
        } else {
          image.alpha = 1f
          badge.visibility = View.GONE
        }
        val slide = arrived
        frame.post { arrived = false }
        BlypShellChatImageLoader.loadThumb(
          image.context,
          conversationId,
          photo.imageKey.orEmpty(),
          photo.imageThumbKey,
          photo.localImagePath,
          image,
          spin,
          slide,
        )
        frame.setOnLongClickListener {
          (frame.context as? ShellChatThreadActivity)?.onMessageLongPress(photo, frame)
          true
        }
        frame.setOnClickListener {
          openPhotos(frame.context, conversationId, group, holder.bindingAdapterPosition)
        }
      }
    }

    companion object {
      private fun openPhotos(
        context: android.content.Context,
        conversationId: String,
        group: List<ShellChatBubble>,
        index: Int,
      ) {
        if (group.isEmpty()) return
        val i = index.coerceIn(0, group.lastIndex)
        ShellChatPhotoActivity.start(
          context,
          conversationId,
          group.map { it.imageKey.orEmpty() },
          group.map { it.localImagePath.orEmpty() },
          i,
        )
      }

      private const val VIEW_TEXT_MINE = 0
      private const val VIEW_TEXT_PEER = 1
      private const val VIEW_IMG_MINE = 2
      private const val VIEW_IMG_PEER = 3
      private const val VIEW_VOICE_MINE = 4
      private const val VIEW_VOICE_PEER = 5
      private const val VIEW_DOC_MINE = 6
      private const val VIEW_DOC_PEER = 7
      private const val VIEW_MONEY_MINE = 8
      private const val VIEW_MONEY_PEER = 9
      private const val VIEW_PLACE_MINE = 10
      private const val VIEW_PLACE_PEER = 11

      fun bindStamp(root: View, text: String?) {
        val parent = root as? ViewGroup ?: return
        var stamp = parent.findViewWithTag<TextView>("blyp_stamp")
        if (text.isNullOrBlank()) {
          stamp?.visibility = View.GONE
          if (parent is FrameLayout) {
            for (i in 0 until parent.childCount) {
              val child = parent.getChildAt(i)
              if (child === stamp) continue
              val lp = child.layoutParams as? FrameLayout.LayoutParams ?: continue
              if (lp.topMargin != 0) {
                lp.topMargin = 0
                child.layoutParams = lp
              }
            }
          }
          return
        }
        if (stamp == null) {
          stamp =
            TextView(parent.context).apply {
              tag = "blyp_stamp"
              gravity = Gravity.CENTER
              textSize = 12f
              setTextColor(
                androidx.core.content.ContextCompat.getColor(parent.context, R.color.blyp_shell_muted),
              )
            }
          if (parent is LinearLayout) {
            val lp =
              LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
              )
            val d = parent.resources.displayMetrics.density
            lp.topMargin = (8 * d).toInt()
            lp.bottomMargin = (4 * d).toInt()
            parent.addView(stamp, 0, lp)
          } else {
            parent.addView(
              stamp,
              FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.CENTER_HORIZONTAL,
              ),
            )
          }
        }
        stamp.text = text
        stamp.visibility = View.VISIBLE
        if (parent is FrameLayout) {
          stamp.post {
            val h = stamp.height
            for (i in 0 until parent.childCount) {
              val child = parent.getChildAt(i)
              if (child === stamp) continue
              val lp = child.layoutParams as? FrameLayout.LayoutParams ?: continue
              if (lp.topMargin != h) {
                lp.topMargin = h
                child.layoutParams = lp
              }
            }
          }
        }
      }

      fun stampLabel(ctx: Context, prev: ShellChatBubble?, row: ShellChatBubble): String? {
        val zone = java.time.ZoneId.systemDefault()
        val cur =
          try {
            java.time.Instant.parse(row.createdAt).atZone(zone)
          } catch (_: Exception) {
            return null
          }
        val before =
          prev?.let {
            try {
              java.time.Instant.parse(it.createdAt).atZone(zone)
            } catch (_: Exception) {
              null
            }
          }
        val gap =
          before == null ||
            before.toLocalDate() != cur.toLocalDate() ||
            java.time.Duration.between(before.toInstant(), cur.toInstant()).toMinutes() >= 60
        if (!gap) return null
        val hm = java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(cur)
        val today = java.time.LocalDate.now(zone)
        val day = cur.toLocalDate()
        val prefix =
          when (day) {
            today -> ctx.getString(R.string.blyp_shell_chat_today)
            today.minusDays(1) -> ctx.getString(R.string.blyp_shell_chat_yesterday)
            else ->
              java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.getDefault()).format(cur)
          }
        return "$prefix $hm"
      }

      fun bindSendMeta(root: View, row: ShellChatBubble, seenIso: String?) {
        val ctx = root.context
        val act = ctx as? ShellChatThreadActivity
        val time = root.findViewById<TextView?>(R.id.blyp_chat_time)
        val clock = root.findViewById<TextView?>(R.id.blyp_chat_clock)
        val seenView = root.findViewById<TextView?>(R.id.blyp_chat_seen)
        if (time == null && clock == null) return
        if (act?.isReactChrome(row.id) == true) {
          clock?.visibility = View.GONE
          seenView?.visibility = View.GONE
          time?.text = ""
          if (time != null) {
            val shown = time.tag == "in"
            if (!shown) {
              time.tag = "in"
              slideTime(time, true)
            } else {
              time.visibility = View.VISIBLE
              time.alpha = 1f
              time.translationY = 0f
            }
          }
          bindReactChromeActions(root, row)
          return
        }
        hideReactChromeActions(root)
        if (row.outboundPending && time != null) {
          clock?.visibility = View.GONE
          seenView?.visibility = View.GONE
          time.text = ctx.getString(BlypShellChatOutbox.pendingLabel(row.clientId))
          showTimeSteady(time)
          bindMetaDelete(root, row, false, "")
          return
        }
        clock?.visibility = View.GONE
        seenView?.visibility = View.GONE
        val flash = row.mine && act?.sentFlashOn(row.id) == true
        val show = flash || act?.isMetaShown(row.id) == true
        val hm = formatMessageTime(row.createdAt)
        val seenHm = seenIso?.let { formatMessageTime(it) }.orEmpty()
        val line =
          when {
            !show || hm.isEmpty() -> ""
            flash -> ctx.getString(R.string.blyp_shell_chat_sent_at, hm)
            seenHm.isNotEmpty() ->
              hm + " · " + ctx.getString(R.string.blyp_shell_chat_seen_at, seenHm)
            else -> hm
          }
        time?.text = line
        time?.translationX = 0f
        if (time == null) return
        val shown = time.tag == "in"
        if (line.isEmpty()) {
          if (shown) {
            time.tag = "out"
            slideTime(time, false)
          } else {
            time.alpha = 1f
            time.translationY = 0f
            time.visibility = View.GONE
            time.tag = "out"
          }
        } else if (!shown) {
          time.tag = "in"
          slideTime(time, true)
        } else {
          time.tag = "in"
          time.visibility = View.VISIBLE
          time.alpha = 1f
          time.translationY = 0f
        }
        bindMetaDelete(root, row, show, line)
      }

      private fun bindReactChromeActions(root: View, row: ShellChatBubble) {
        val act = root.context as? ShellChatThreadActivity ?: return
        val metaRow = root.findViewById<TextView?>(R.id.blyp_chat_time)?.parent as? ViewGroup ?: return
        val d = root.resources.displayMetrics.density
        val del = root.findViewById<ImageView?>(R.id.blyp_chat_meta_delete)
        var reply = metaRow.findViewWithTag<ImageView>("blyp_react_reply")
        if (reply == null) {
          reply =
            ImageView(root.context).apply {
              tag = "blyp_react_reply"
              setImageResource(R.drawable.blyp_shell_ic_reply_pro)
              scaleType = ImageView.ScaleType.CENTER_INSIDE
              contentDescription = root.context.getString(R.string.blyp_shell_chat_menu_reply)
              background = ContextCompat.getDrawable(context, R.drawable.blyp_shell_react_action_bg)
              val pad = (5 * d).toInt()
              setPadding(pad, pad, pad, pad)
              layoutParams =
                android.widget.LinearLayout.LayoutParams((28 * d).toInt(), (28 * d).toInt()).apply {
                  marginEnd = (4 * d).toInt()
                }
            }
          val insertAt = metaRow.indexOfChild(del).let { if (it >= 0) it else metaRow.childCount }
          metaRow.addView(reply, insertAt)
        }
        reply.visibility = View.VISIBLE
        reply.alpha = 0f
        reply.scaleX = 0.7f
        reply.scaleY = 0.7f
        reply.translationY = -8 * d
        reply
          .animate()
          .alpha(1f)
          .scaleX(1f)
          .scaleY(1f)
          .translationY(0f)
          .setDuration(300)
          .setInterpolator(android.view.animation.OvershootInterpolator(1.6f))
          .start()
        reply.setOnClickListener {
          act.reactChromeKeep = true
          act.dismissReactFan()
          act.clearReactChrome()
          act.armReply(row)
        }
        if (del != null) {
          del.setImageResource(R.drawable.blyp_shell_ic_trash_muted)
          del.background = ContextCompat.getDrawable(root.context, R.drawable.blyp_shell_react_action_bg)
          del.visibility = View.VISIBLE
          del.alpha = 0f
          del.scaleX = 0.7f
          del.scaleY = 0.7f
          del.translationY = -8 * d
          del
            .animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .setDuration(300)
            .setStartDelay(35)
            .setInterpolator(android.view.animation.OvershootInterpolator(1.6f))
            .start()
          del.setOnClickListener {
            act.reactChromeKeep = true
            act.dismissReactFan()
            act.clearReactChrome()
            if (act.canDeleteForEveryone(row)) act.confirmDeleteForEveryone(row)
            else act.deleteMessage(row, "me")
          }
          del.isClickable = true
          del.isFocusable = true
        }
      }

      private fun hideReactChromeActions(root: View) {
        val metaRow = root.findViewById<TextView?>(R.id.blyp_chat_time)?.parent as? ViewGroup
        metaRow?.findViewWithTag<ImageView>("blyp_react_reply")?.visibility = View.GONE
        val del = root.findViewById<ImageView?>(R.id.blyp_chat_meta_delete)
        if (del != null) {
          del.background = null
          del.scaleX = 1f
          del.scaleY = 1f
          del.translationY = 0f
        }
      }

      private fun bindMetaDelete(root: View, row: ShellChatBubble, metaOpen: Boolean, line: String) {
        val del = root.findViewById<ImageView?>(R.id.blyp_chat_meta_delete) ?: return
        // Poubelle rouge à côté de la date : retirée. Suppression = maintien → icône grise.
        if ((root.context as? ShellChatThreadActivity)?.isReactChrome(row.id) == true) return
        del.background = null
        del.visibility = View.GONE
        del.setOnClickListener(null)
      }

      private fun showTimeSteady(time: TextView) {
        (time.getTag(R.id.blyp_chat_clock) as? android.animation.ValueAnimator)?.cancel()
        time.animate().cancel()
        val row = (time.parent as? View) ?: time
        row.visibility = View.VISIBLE
        val lp = row.layoutParams
        lp.height = ViewGroup.LayoutParams.WRAP_CONTENT
        row.layoutParams = lp
        time.visibility = View.VISIBLE
        time.alpha = 1f
        time.translationY = 0f
        time.tag = "in"
      }

      private fun slideTime(time: TextView, open: Boolean) {
        val row = (time.parent as? View) ?: time
        (time.getTag(R.id.blyp_chat_clock) as? android.animation.ValueAnimator)?.cancel()
        time.animate().cancel()
        val travel = 14f * time.resources.displayMetrics.density
        val ease = android.view.animation.DecelerateInterpolator()
        if (open) {
          row.visibility = View.VISIBLE
          time.visibility = View.VISIBLE
          val lp = row.layoutParams
          lp.height = ViewGroup.LayoutParams.WRAP_CONTENT
          row.layoutParams = lp
          val parentW = (row.parent as? View)?.width ?: time.resources.displayMetrics.widthPixels
          row.measure(
            View.MeasureSpec.makeMeasureSpec(parentW, View.MeasureSpec.AT_MOST),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
          )
          val target = row.measuredHeight.coerceAtLeast((16 * time.resources.displayMetrics.density).toInt())
          lp.height = 0
          row.layoutParams = lp
          time.alpha = 0f
          time.translationY = -travel
          val anim = android.animation.ValueAnimator.ofInt(0, target)
          anim.duration = 320
          anim.interpolator = ease
          anim.addUpdateListener {
            lp.height = it.animatedValue as Int
            row.layoutParams = lp
          }
          anim.addListener(
            object : android.animation.AnimatorListenerAdapter() {
              override fun onAnimationEnd(animation: android.animation.Animator) {
                lp.height = ViewGroup.LayoutParams.WRAP_CONTENT
                row.layoutParams = lp
              }
            },
          )
          time.setTag(R.id.blyp_chat_clock, anim)
          anim.start()
          time.animate().alpha(1f).translationY(0f).setDuration(320).setInterpolator(ease).start()
        } else {
          val from = if (row.height > 0) row.height else row.measuredHeight
          if (from <= 0) {
            time.visibility = View.GONE
            time.translationY = 0f
            return
          }
          val lp = row.layoutParams
          val anim = android.animation.ValueAnimator.ofInt(from, 0)
          anim.duration = 280
          anim.interpolator = ease
          anim.addUpdateListener {
            lp.height = it.animatedValue as Int
            row.layoutParams = lp
          }
          anim.addListener(
            object : android.animation.AnimatorListenerAdapter() {
              override fun onAnimationEnd(animation: android.animation.Animator) {
                time.visibility = View.GONE
                time.alpha = 1f
                time.translationY = 0f
                lp.height = ViewGroup.LayoutParams.WRAP_CONTENT
                row.layoutParams = lp
              }
            },
          )
          time.setTag(R.id.blyp_chat_clock, anim)
          anim.start()
          time.animate().alpha(0f).translationY(-travel).setDuration(280).setInterpolator(ease).start()
        }
      }

      private fun formatMessageTime(iso: String): String {
        if (iso.isBlank()) return ""
        return try {
          val zoned = java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
          java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(zoned)
        } catch (_: Exception) {
          ""
        }
      }

      fun bindReactions(root: View, row: ShellChatBubble) {
        val chip = root.findViewById<TextView?>(R.id.blyp_chat_reactions) ?: return
        root.findViewWithTag<View>("blyp_react_corner")?.let {
          (it.parent as? ViewGroup)?.removeView(it)
        }
        val act = root.context as? ShellChatThreadActivity
        val density = root.resources.displayMetrics.density
        val removing = act?.takeReactRemove(row.id) == true
        if (row.reactions.isEmpty() || row.deletedForAll) {
          if (chip.visibility == View.VISIBLE) {
            if (removing) {
              val body = root.findViewById<View?>(R.id.blyp_chat_body)
              chip
                .animate()
                .scaleX(0.05f)
                .scaleY(0.05f)
                .alpha(0f)
                .translationY((-6f) * density)
                .setDuration(240)
                .setInterpolator(android.view.animation.AccelerateInterpolator(1.2f))
                .withEndAction {
                  chip.visibility = View.GONE
                  chip.scaleX = 1f
                  chip.scaleY = 1f
                  chip.alpha = 1f
                  chip.translationY = 0f
                  val bodyLp = body?.layoutParams as? ViewGroup.MarginLayoutParams
                  if (bodyLp != null && bodyLp.topMargin > 0) {
                    val start = bodyLp.topMargin
                    android.animation.ValueAnimator.ofInt(start, 0).apply {
                      duration = 260
                      interpolator = android.view.animation.DecelerateInterpolator()
                      addUpdateListener { va ->
                        val p = body.layoutParams as? ViewGroup.MarginLayoutParams ?: return@addUpdateListener
                        p.topMargin = va.animatedValue as Int
                        body.layoutParams = p
                      }
                      start()
                    }
                  }
                }
                .start()
            } else {
              chip.visibility = View.GONE
              val body = root.findViewById<View?>(R.id.blyp_chat_body)
              val lp = body?.layoutParams as? ViewGroup.MarginLayoutParams
              if (lp != null && lp.topMargin != 0) {
                lp.topMargin = 0
                body.layoutParams = lp
              }
            }
          } else {
            val body = root.findViewById<View?>(R.id.blyp_chat_body)
            val lp = body?.layoutParams as? ViewGroup.MarginLayoutParams
            if (lp != null && lp.topMargin != 0) {
              lp.topMargin = 0
              body.layoutParams = lp
            }
          }
          return
        }
        val ctx = root.context
        val myId = act?.myUserId()?.trim().orEmpty()
        data class Group(val emoji: String, var count: Int, var mine: Boolean)
        val groups = LinkedHashMap<String, Group>()
        for (reaction in row.reactions) {
          val emoji = reaction.emoji.trim()
          if (emoji.isEmpty()) continue
          val g = groups.getOrPut(emoji) { Group(emoji, 0, false) }
          g.count += 1
          if (myId.isNotEmpty() && reaction.userId == myId) g.mine = true
        }
        val ordered = groups.values.toList()
        val primary = ordered.firstOrNull() ?: return
        val label =
          ordered.take(3).joinToString("") { g ->
            if (g.count > 1) "${g.emoji}${g.count}" else g.emoji
          }
        chip.text = label
        chip.background = ContextCompat.getDrawable(ctx, R.drawable.blyp_shell_react_chip)
        chip.setTextColor(ContextCompat.getColor(ctx, R.color.blyp_shell_text))
        chip.minWidth = (26 * density).toInt()
        chip.contentDescription =
          if (primary.mine) ctx.getString(R.string.blyp_shell_chat_react_remove_a11y)
          else ctx.getString(R.string.blyp_shell_chat_react_pick_a11y, primary.emoji)
        chip.setOnClickListener {
          val mine = ordered.firstOrNull { it.mine } ?: primary
          act?.reactTo(row, mine.emoji, burstFrom = chip)
        }
        chip.visibility = View.VISIBLE
        val frame = chip.parent as? ViewGroup
        frame?.clipChildren = false
        frame?.clipToPadding = false
        (root as? ViewGroup)?.clipChildren = false
        (root as? ViewGroup)?.clipToPadding = false
        val body = root.findViewById<View?>(R.id.blyp_chat_body)
        if (body != null) {
          val need = (14 * density).toInt()
          val lp = body.layoutParams as? ViewGroup.MarginLayoutParams
          if (lp != null && lp.topMargin != need) {
            lp.topMargin = need
            body.layoutParams = lp
          }
        }
        val padTop = (2 * density).toInt()
        if (root.paddingTop < padTop) {
          root.setPadding(root.paddingLeft, padTop, root.paddingRight, root.paddingBottom)
        }
        val bounceIn = act?.takeReactBounce(row.id) == true
        if (bounceIn) {
          chip.scaleX = 0.2f
          chip.scaleY = 0.2f
          chip.alpha = 0.5f
          chip
            .animate()
            .scaleX(1f)
            .scaleY(1f)
            .alpha(1f)
            .setDuration(380)
            .setInterpolator(android.view.animation.OvershootInterpolator(3f))
            .start()
        } else {
          chip.animate().cancel()
          chip.scaleX = 1f
          chip.scaleY = 1f
          chip.alpha = 1f
        }
      }

    }
  }

  companion object {
    private const val EXTRA_CONVERSATION_ID = "blyp_shell_chat_thread_id"
    private const val EXTRA_PEER_NAME = "blyp_shell_chat_thread_peer"
    private const val EXTRA_PEER_PHONE = "blyp_shell_chat_thread_phone"
    private const val EXTRA_PEER_AVATAR = "blyp_shell_chat_thread_avatar"

    fun start(
      context: Context,
      conversationId: String,
      peerName: String? = null,
      peerPhone: String? = null,
      peerAvatarUrl: String? = null,
    ) {
      val id = conversationId.trim()
      if (id.isEmpty()) return
      context.startActivity(
        Intent(context, ShellChatThreadActivity::class.java).apply {
          putExtra(EXTRA_CONVERSATION_ID, id)
          peerName?.trim()?.takeIf { it.isNotEmpty() }?.let {
            putExtra(EXTRA_PEER_NAME, it)
          }
          peerPhone?.trim()?.takeIf { it.isNotEmpty() }?.let {
            putExtra(EXTRA_PEER_PHONE, it)
          }
          peerAvatarUrl?.trim()?.takeIf { it.isNotEmpty() }?.let {
            putExtra(EXTRA_PEER_AVATAR, it)
          }
        },
      )
    }
  }
}