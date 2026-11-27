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
import androidx.fragment.app.Fragment
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.paymentannounce.AdminAlertPresenter

/** Coque produit native — Pay / Historique / Profil / Messages. */
class BlypNativeShellActivity : AppCompatActivity() {
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

    findViewById<View>(R.id.blyp_shell_money_rail)?.setOnClickListener {
      val stub =
        View(this).apply {
          layoutParams = ViewGroup.LayoutParams(1, (24 * resources.displayMetrics.density).toInt())
        }
      BlypShellDialogs.alertBuilder(this)
        .setView(stub)
        .setCancelable(true)
        .show()
    }

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
            BlypShellChatSounds.warm()
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
    val icon =
      if (commerce) R.drawable.blyp_shell_tab_ic_cash else R.drawable.blyp_shell_tab_ic_pay
    tab.setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0)
    val selected = activeTabId == R.id.blyp_shell_tab_pay
    val color =
      ContextCompat.getColor(
        this,
        if (selected) R.color.blyp_shell_accent else R.color.blyp_shell_tab_inactive,
      )
    tab.compoundDrawableTintList = android.content.res.ColorStateList.valueOf(color)
  }

  private fun highlightTab(selectedId: Int) {
    paintPayTabTitle()
    val accent = ContextCompat.getColor(this, R.color.blyp_shell_accent)
    val inactive = ContextCompat.getColor(this, R.color.blyp_shell_tab_inactive)
    for (id in TAB_IDS) {
      val tab = findViewById<TextView>(id) ?: continue
      val color = if (id == selectedId) accent else inactive
      tab.setTextColor(color)
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
