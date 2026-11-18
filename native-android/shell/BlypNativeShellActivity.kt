package com.haroldndougou.blyp.shell

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
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

/** Coque produit native — Pay / Historique / Profil ; Messages → îlot RN. */
class BlypNativeShellActivity : AppCompatActivity() {
  private var appliedNightMode: Int = Configuration.UI_MODE_NIGHT_UNDEFINED
  private var activeTabId: Int = R.id.blyp_shell_tab_pay
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
    findViewById<View>(R.id.blyp_shell_tab_messages)?.setOnClickListener {
      startActivity(
        BlypShellLaunchBridge.buildMessagesIslandIntent(com.haroldndougou.blyp.MainActivity::class.java),
      )
    }

    if (savedInstanceState == null) {
      selectTab(Tab.PAY)
    } else {
      activeTabId = savedInstanceState.getInt(STATE_TAB_ID, R.id.blyp_shell_tab_pay)
      selectTab(tabFromViewId(activeTabId))
    }
    BlypShellPerfMarks.end("shell_open")
    appliedNightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    openPayIfAsked(intent)
    root.post { if (!isFinishing) BlypShellPush.onShellReady(this, notifPermission) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    openPayIfAsked(intent)
  }

  private fun openPayIfAsked(intent: Intent?) {
    if (intent?.getBooleanExtra(EXTRA_OPEN_PAY, false) != true) return
    intent.removeExtra(EXTRA_OPEN_PAY)
    selectTab(Tab.PAY)
  }

  override fun onStart() {
    super.onStart()
    BlypShellProductEngine.onShellStarted(this)
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
    if (tab == Tab.MESSAGES) return
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
      Tab.MESSAGES -> throw IllegalArgumentException("messages")
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
    if (!wrong) return
    fm.beginTransaction().remove(payFrag).commitNowAllowingStateLoss()
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

  private fun highlightTab(selectedId: Int) {
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
      else -> Tab.PAY
    }

  companion object {
    private const val STATE_TAB_ID = "blyp_shell_tab_id"
    private val TAB_IDS =
      intArrayOf(
        R.id.blyp_shell_tab_pay,
        R.id.blyp_shell_tab_history,
        R.id.blyp_shell_tab_profile,
        R.id.blyp_shell_tab_messages,
      )
    const val EXTRA_OPEN_PAY = "blyp_shell_open_pay"
    private const val TAG_TAB_PAY = "blyp_shell_tab_pay"
    private const val TAG_TAB_HISTORY = "blyp_shell_tab_history"
    private const val TAG_TAB_PROFILE = "blyp_shell_tab_profile"
    private const val TAG_TAB_MESSAGES = "blyp_shell_tab_messages"
    private val TAB_CONTENT = arrayOf(Tab.PAY, Tab.HISTORY, Tab.PROFILE)
  }
}
