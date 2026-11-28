package com.haroldndougou.blyp.shell

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.view.ViewTreeObserver
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.Fragment
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.paymentannounce.AdminAlertPresenter

/** Coque produit native — Pay / Historique / Profil / Messages. */
class BlypNativeShellActivity : BlypShellActivity() {
  private var appliedNightMode: Int = Configuration.UI_MODE_NIGHT_UNDEFINED
  private var activeTabId: Int = R.id.blyp_shell_tab_messages
  private val notifPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      BlypShellPush.onPermissionResult(this, granted)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    BlypShellPerfMarks.start("shell_open")
    BlypShellAuthMirror.ensureHydrated(this)
    if (!BlypShellSession.hasValidSession(this)) {
      ShellSignInActivity.startFresh(this)
      finish()
      return
    }
    if (BlypShellSession.needsOnboarding(this)) {
      ShellNativeOnboardingActivity.start(this)
      finish()
      return
    }
    setContentView(R.layout.blyp_native_shell)
    applySystemBarAppearance()

    val root = findViewById<View>(R.id.blyp_native_shell_root)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.setPadding(bars.left, bars.top, bars.right, 0)
      findViewById<View>(R.id.blyp_shell_bottom_bar)?.setPadding(
        bars.left,
        0,
        bars.right,
        bars.bottom,
      )
      insets
    }

    bindTab(R.id.blyp_shell_tab_pay, Tab.PAY)
    bindTab(R.id.blyp_shell_tab_history, Tab.HISTORY)
    bindTab(R.id.blyp_shell_tab_profile, Tab.PROFILE)
    bindTab(R.id.blyp_shell_tab_messages, Tab.MESSAGES)

    findViewById<View>(R.id.blyp_shell_money_rail)?.setOnClickListener { openMoneyRailPay() }
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val host = findViewById<View>(R.id.blyp_shell_pay_host)
          if (host?.visibility == View.VISIBLE) {
            hideRailPay()
          } else {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
          }
        }
      },
    )

    if (savedInstanceState == null) {
      selectTab(Tab.MESSAGES)
    } else {
      activeTabId = savedInstanceState.getInt(STATE_TAB_ID, R.id.blyp_shell_tab_messages)
      selectTab(tabFromViewId(activeTabId))
    }
    BlypShellPerfMarks.end("shell_open")
    appliedNightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    BlypShellLaunchBridge.captureFromIntent(intent)
    openPayIfAsked(intent)
    maybeOpenPendingChat(intent)
    root.viewTreeObserver.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          if (root.viewTreeObserver.isAlive) {
            root.viewTreeObserver.removeOnPreDrawListener(this)
          }
          root.post {
            if (isFinishing) return@post
            BlypShellChatHistoryWipe.startOnce(this@BlypNativeShellActivity)
            BlypShellChatSounds.warm(this@BlypNativeShellActivity)
            AdminAlertPresenter.prepare(this@BlypNativeShellActivity)
            BlypShellPush.onShellReady(this@BlypNativeShellActivity, notifPermission)
          }
          return true
        }
      },
    )
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    BlypShellLaunchBridge.captureFromIntent(intent)
    openPayIfAsked(intent)
    maybeOpenPendingChat(intent)
  }

  private fun openPayIfAsked(intent: Intent?) {
    if (intent?.getBooleanExtra(EXTRA_OPEN_PAY, false) != true) return
    intent.removeExtra(EXTRA_OPEN_PAY)
    selectTab(Tab.PAY)
  }

  private fun maybeOpenPendingChat(intent: Intent?) {
    val direct = intent?.getStringExtra(BlypShellLaunchBridge.EXTRA_OPEN_CHAT_ID)?.trim().orEmpty()
    if (direct.isNotEmpty()) {
      intent?.removeExtra(BlypShellLaunchBridge.EXTRA_OPEN_CHAT_ID)
      selectTab(Tab.MESSAGES)
      ShellChatThreadActivity.start(this, direct, null)
      return
    }
    val staged = BlypShellLaunchBridge.consumeStagedChat() ?: return
    selectTab(Tab.MESSAGES)
    ShellChatThreadActivity.start(this, staged.first, null)
  }

  override fun onStart() {
    super.onStart()
    val root = window.decorView
    root.viewTreeObserver.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          if (root.viewTreeObserver.isAlive) {
            root.viewTreeObserver.removeOnPreDrawListener(this)
          }
          root.post {
            if (isFinishing) return@post
            BlypLateInit.afterFirstFrame(applicationContext)
            startShellWork()
          }
          return true
        }
      },
    )
  }

  override fun onStop() {
    if (messagesScanOn) {
      messagesScanOn = false
      BlypShellNearbyScan.stopForChat()
    }
    BlypShellProductEngine.onShellStopped(this)
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    BlypShellSessionRefresh.ensureFreshAsync(this)
    if (BlypShellSession.needsOnboarding(this)) {
      ShellNativeOnboardingActivity.start(this)
      finish()
      return
    }
    ensurePayTabMatchesCommerceMode()
    paintPayTabTitle()
    BlypShellClicks.arm(window.decorView)
    if (activeTabId == R.id.blyp_shell_tab_messages) {
      messagesScanOn = false
      syncMessagesNearbyScan(true)
    }
    BlypShellMoneyRequests.pullAsync(this)
    val prefs = getSharedPreferences("blyp_shell_session", MODE_PRIVATE)
    if (!prefs.getBoolean("tx_keep_claude_v1", false)) {
      prefs.edit().putBoolean("tx_keep_claude_v1", true).apply()
      Thread {
        BlypTransactionStore.purgeExceptCounterparty(applicationContext, "Claude Bessong")
      }.start()
    }
  }

  private fun startShellWork() {
    BlypShellProductEngine.onShellStarted(this)
    BlypShellUiRefresh.notifyWalletChanged()
    BlypShellUiRefresh.notifyShellBadgesChanged()
    BlypShellBadgeNativeSync.hydrateBadgesFromKv(this)
    BlypShellBadgeNativeSync.refreshFromLocalCache(this)
    BlypShellOfflinePayQueue.flush(applicationContext)
    BlypShellPush.registerAsync(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val next = newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK
    if (next != appliedNightMode) {
      appliedNightMode = next
      recreate()
      return
    }
    applySystemBarAppearance()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putInt(STATE_TAB_ID, activeTabId)
  }

  private fun applySystemBarAppearance() {
    window.statusBarColor = ContextCompat.getColor(this, R.color.blyp_shell_bg)
    window.setBackgroundDrawableResource(R.color.blyp_shell_bg)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val night =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = !night
  }

  private enum class Tab {
    PAY,
    HISTORY,
    PROFILE,
    MESSAGES,
  }

  private fun bindTab(viewId: Int, tab: Tab) {
    findViewById<View>(viewId).setOnClickListener { selectTab(tab) }
  }

  fun openPayTab() {
    selectTab(Tab.PAY)
  }

  fun isPayTabVisible(): Boolean = activeTabId == R.id.blyp_shell_tab_pay

  private fun selectTab(tab: Tab) {
    val viewId =
      when (tab) {
        Tab.PAY -> R.id.blyp_shell_tab_pay
        Tab.HISTORY -> R.id.blyp_shell_tab_history
        Tab.PROFILE -> R.id.blyp_shell_tab_profile
        Tab.MESSAGES -> R.id.blyp_shell_tab_messages
      }
    activeTabId = viewId
    highlightTab(viewId)
    hideRailPay()
    syncMoneyRail(tab == Tab.MESSAGES)

    val fm = supportFragmentManager
    val tx = fm.beginTransaction()
    for (t in TAB_CONTENT) {
      val tTag = fragmentTag(t)
      var frag = fm.findFragmentByTag(tTag)
      if (t == tab) {
        if (frag == null) {
          frag = newFragment(t)
          tx.add(R.id.blyp_shell_content, frag, tTag)
        } else {
          tx.show(frag)
        }
      } else if (frag != null) {
        tx.hide(frag)
      }
    }
    tx.commit()
    syncMessagesNearbyScan(tab == Tab.MESSAGES)
  }

  /** Le $ n’apparaît que sur la liste des discussions. */
  private fun syncMoneyRail(onMessages: Boolean) {
    val rail = findViewById<View>(R.id.blyp_shell_money_rail) ?: return
    val show = if (onMessages) View.VISIBLE else View.GONE
    rail.visibility = show
    val parent = rail.parent as? ViewGroup ?: return
    val idx = parent.indexOfChild(rail)
    if (idx > 0) parent.getChildAt(idx - 1)?.visibility = show
    if (idx >= 0 && idx + 1 < parent.childCount) parent.getChildAt(idx + 1)?.visibility = show
  }

  private var messagesScanOn = false

  /** Détection du commerce à côté tant que Messages est à l’écran. */
  private fun syncMessagesNearbyScan(on: Boolean) {
    if (on == messagesScanOn) return
    messagesScanOn = on
    if (on) BlypShellNearbyScan.startForChat(this) else BlypShellNearbyScan.stopForChat()
  }

  private fun openMoneyRailPay() {
    val ctx = applicationContext
    val peer = BlypShellNearbyScan.snapshot()
    if (peer != null && peer.displayName.isNotBlank() && !isOwnNearby(peer)) {
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
    }
    if (supportFragmentManager.findFragmentByTag("rail_pay") != null &&
      findViewById<View>(R.id.blyp_shell_pay_host)?.visibility == View.VISIBLE
    ) {
      hideRailPay()
      return
    }
    findViewById<View>(R.id.blyp_shell_pay_host)?.visibility = View.VISIBLE
    findViewById<View>(R.id.blyp_shell_pay_scrim)?.apply {
      visibility = View.VISIBLE
      setOnClickListener { hideRailPay() }
    }
    val existing = supportFragmentManager.findFragmentByTag("rail_pay")
    val tx = supportFragmentManager.beginTransaction()
    if (existing == null) {
      tx.add(
        R.id.blyp_shell_pay_host,
        PayShellKeypadFragment().apply {
          arguments = android.os.Bundle().apply { putBoolean(PayShellKeypadFragment.ARG_COMPACT, true) }
        },
        "rail_pay",
      )
    } else {
      tx.show(existing)
    }
    tx.commit()
  }

  fun closeRailPay() {
    hideRailPay()
  }

  private fun hideRailPay() {
    val host = findViewById<View>(R.id.blyp_shell_pay_host)
    val open = host?.visibility == View.VISIBLE
    host?.visibility = View.GONE
    findViewById<View>(R.id.blyp_shell_pay_scrim)?.visibility = View.GONE
    if (open) PayShellState.clearDigits()
    val existing = supportFragmentManager.findFragmentByTag("rail_pay") ?: return
    if (existing.isHidden) return
    supportFragmentManager.beginTransaction().hide(existing).commit()
  }

  private fun isOwnNearby(peer: BlypShellNearbyScan.Peer): Boolean {
    val mine = BlypShellSession.accountId(this)?.trim()?.uppercase().orEmpty()
    if (mine.isNotEmpty() && mine == peer.accountId.uppercase()) return true
    val phone = BlypShellSession.phone(this)?.replace(Regex("\\D"), "")?.takeLast(9).orEmpty()
    return phone.length == 9 && phone == peer.phoneDigits
  }

  private fun newFragment(tab: Tab): Fragment =
    when (tab) {
      Tab.PAY -> payTabFragment()
      Tab.HISTORY -> HistoryShellFragment()
      Tab.PROFILE -> ProfileShellFragment()
      Tab.MESSAGES -> MessagesInboxFragment()
    }

  private fun payTabFragment(): Fragment {
    if (!BlypShellSession.isCommerceMode(this)) {
      return PayShellKeypadFragment()
    }
    return if (BlypShellCommerceSession.isSoaCar(this)) {
      BlypShellPerfMarks.start("soa_car_open")
      SoaCarShellFragment()
    } else {
      BlypShellPerfMarks.start("commerce_open")
      CommerceShellFragment()
    }
  }

  internal fun ensurePayTabMatchesCommerceMode() {
    val fm = supportFragmentManager
    val payFrag = fm.findFragmentByTag(TAG_TAB_PAY) ?: return
    val commerce = BlypShellSession.isCommerceMode(this)
    val soa = commerce && BlypShellCommerceSession.isSoaCar(this)
    val wrong =
      when {
        !commerce && payFrag !is PayShellKeypadFragment -> true
        commerce && soa && payFrag !is SoaCarShellFragment -> true
        commerce && !soa && payFrag !is CommerceShellFragment -> true
        else -> false
      }
    if (!wrong) {
      paintPayTabTitle()
      return
    }
    fm.beginTransaction().remove(payFrag).commitNowAllowingStateLoss()
    paintPayTabTitle()
    if (activeTabId == R.id.blyp_shell_tab_pay) {
      selectTab(Tab.PAY)
    }
  }

  private fun fragmentTag(tab: Tab): String =
    when (tab) {
      Tab.PAY -> TAG_TAB_PAY
      Tab.HISTORY -> TAG_TAB_HISTORY
      Tab.PROFILE -> TAG_TAB_PROFILE
      Tab.MESSAGES -> TAG_TAB_MESSAGES
    }

  internal fun paintPayTabTitle() {
    val tab = findViewById<TextView>(R.id.blyp_shell_tab_pay) ?: return
    val commerce = BlypShellSession.isCommerceMode(this)
    tab.setText(
      if (commerce) R.string.blyp_shell_tab_collect else R.string.blyp_shell_tab_pay,
    )
    findViewById<TextView>(R.id.blyp_shell_tab_history)?.setText(
      if (commerce) R.string.blyp_shell_tab_book else R.string.blyp_shell_tab_history,
    )
  }

  private fun highlightTab(selectedId: Int) {
    paintPayTabTitle()
    val accent = ContextCompat.getColor(this, R.color.blyp_shell_accent)
    val inactive = ContextCompat.getColor(this, R.color.blyp_shell_tab_inactive)
    val commerce = BlypShellSession.isCommerceMode(this)
    for (id in TAB_IDS) {
      val tab = findViewById<TextView>(id) ?: continue
      val on = id == selectedId
      val color = if (on) accent else inactive
      tab.setTextColor(color)
      val icon =
        when (id) {
          R.id.blyp_shell_tab_messages ->
            if (on) R.drawable.blyp_shell_tab_ic_messages_filled
            else R.drawable.blyp_shell_tab_ic_messages
          R.id.blyp_shell_tab_pay ->
            when {
              commerce -> R.drawable.blyp_shell_tab_ic_cash
              on -> R.drawable.blyp_shell_tab_ic_pay
              else -> R.drawable.blyp_shell_tab_ic_pay_outline
            }
          R.id.blyp_shell_tab_history -> R.drawable.blyp_shell_tab_ic_history
          R.id.blyp_shell_tab_profile ->
            if (on) R.drawable.blyp_shell_tab_ic_profile
            else R.drawable.blyp_shell_tab_ic_profile_outline
          else -> 0
        }
      if (icon != 0) tab.setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0)
      tab.compoundDrawableTintList = android.content.res.ColorStateList.valueOf(color)
    }
  }

  private fun tabFromViewId(viewId: Int): Tab =
    when (viewId) {
      R.id.blyp_shell_tab_history -> Tab.HISTORY
      R.id.blyp_shell_tab_profile -> Tab.PROFILE
      R.id.blyp_shell_tab_messages -> Tab.MESSAGES
      else -> Tab.MESSAGES
    }

  companion object {
    private const val STATE_TAB_ID = "blyp_shell_tab_id"
    private val TAB_IDS =
      intArrayOf(
        R.id.blyp_shell_tab_messages,
        R.id.blyp_shell_tab_pay,
        R.id.blyp_shell_tab_history,
        R.id.blyp_shell_tab_profile,
      )
    const val EXTRA_OPEN_PAY = "blyp_shell_open_pay"
    private const val TAG_TAB_PAY = "blyp_shell_tab_pay"
    private const val TAG_TAB_HISTORY = "blyp_shell_tab_history"
    private const val TAG_TAB_PROFILE = "blyp_shell_tab_profile"
    private const val TAG_TAB_MESSAGES = "blyp_shell_tab_messages"
    private val TAB_CONTENT = arrayOf(Tab.PAY, Tab.HISTORY, Tab.PROFILE, Tab.MESSAGES)
  }
}
