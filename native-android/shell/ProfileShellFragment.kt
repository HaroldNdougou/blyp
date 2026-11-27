package com.haroldndougou.blyp.shell

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Outline
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.haroldndougou.blyp.BuildConfig
import com.haroldndougou.blyp.MainActivity
import com.haroldndougou.blyp.R
import com.haroldndougou.blyp.paymentannounce.PaymentAnnouncePrefs
import java.io.File
import java.text.NumberFormat
import java.util.Locale

class ProfileShellFragment : Fragment() {
  private var unsubRefresh: (() -> Unit)? = null
  private var unsubBadges: (() -> Unit)? = null
  private var unsubBroadcast: (() -> Unit)? = null
  private var commerceBusyKey: String? = null
  private var smallPayBusy = false
  private var avatarBusy = false
  private var commercesSig = ""
  private var pendingQuickPayOn = false

  private val pickPhoto =
    registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
      if (uri != null) uploadAvatar(uri)
    }

  private val blePermLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
      if (granted.values.all { it }) {
        context?.let { BlypShellTaxiBroadcast.setWantOn(it, true) }
      }
    }

  private val notifPermLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (!pendingQuickPayOn) return@registerForActivityResult
      pendingQuickPayOn = false
      applyQuickPay(granted)
    }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_shell_profile, container, false)
    clipAvatar(root.findViewById(R.id.blyp_profile_avatar_wrap))
    root.findViewById<View>(R.id.blyp_profile_avatar_wrap).setOnClickListener {
      if (avatarBusy) return@setOnClickListener
      pickPhoto.launch("image/*")
    }
    root.findViewById<View>(R.id.blyp_profile_edit_account).setOnClickListener {
      context?.let { ProfileShellHandoff.openProfileSettings(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_top_up).setOnClickListener {
      context?.let { PayShellHandoff.openDeposit(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_withdraw).setOnClickListener {
      context?.let { ShellDepositActivity.startWithdraw(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_commerce_withdraw).setOnClickListener {
      context?.let { ShellDepositActivity.startWithdraw(it) }
    }
    val createCommerce = root.findViewById<View>(R.id.blyp_profile_create_commerce)
    lingerOutline(createCommerce)
    createCommerce.setOnClickListener {
      context?.let { ShellCommerceCreateActivity.start(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_documents).setOnClickListener {
      context?.let { ProfileShellHandoff.openDocuments(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_receipts_row).setOnClickListener {
      context?.let { ProfileShellHandoff.openReceipts(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_broadcast_row).setOnClickListener {
      onBroadcastToggle()
    }
    root.findViewById<View>(R.id.blyp_profile_announce_row).setOnClickListener {
      val ctx = context ?: return@setOnClickListener
      val sw = root.findViewById<SwitchCompat>(R.id.blyp_profile_announce_switch)
      val next = !sw.isChecked
      sw.isChecked = next
      PaymentAnnouncePrefs.setEnabled(ctx.applicationContext, next)
    }
    root.findViewById<View>(R.id.blyp_profile_small_pay_row).setOnClickListener {
      onSmallPayToggle()
    }
    root.findViewById<View>(R.id.blyp_profile_quick_pay_row).setOnClickListener {
      onQuickPayToggle()
    }
    root.findViewById<View>(R.id.blyp_profile_ble_pay_row).setOnClickListener {
      onBlePayToggle()
    }
    root.findViewById<View>(R.id.blyp_profile_warm_row).setOnClickListener {
      onBroadcastToggle()
    }
    root.findViewById<View>(R.id.blyp_profile_kyc_cta).setOnClickListener {
      context?.let { ProfileShellHandoff.openKyc(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_plus).setOnClickListener {
      context?.let { ShellPlusActivity.start(it) }
    }
    root.findViewById<View>(R.id.blyp_profile_change_pin).setOnClickListener {
      context?.let { ShellChangePinActivity.start(it) }
    }
    if (BuildConfig.DEBUG) {
      root.findViewById<TextView>(R.id.blyp_profile_open_rn).apply {
        visibility = View.VISIBLE
        setOnClickListener {
          startActivity(BlypShellLaunchBridge.buildRnAppIntent(MainActivity::class.java))
        }
      }
    }
    root.findViewById<View>(R.id.blyp_profile_sign_out).setOnClickListener { confirmSignOut() }
    tintSwitch(root.findViewById(R.id.blyp_profile_broadcast_switch))
    tintSwitch(root.findViewById(R.id.blyp_profile_announce_switch))
    tintSwitch(root.findViewById(R.id.blyp_profile_small_pay_switch))
    tintSwitch(root.findViewById(R.id.blyp_profile_quick_pay_switch))
    tintSwitch(root.findViewById(R.id.blyp_profile_ble_pay_switch))
    tintSwitch(root.findViewById(R.id.blyp_profile_warm_switch))
    return root
  }

  override fun onStart() {
    super.onStart()
    unsubRefresh = BlypShellUiRefresh.subscribe { bindProfile() }
    unsubBadges = BlypShellUiRefresh.subscribeShellBadges { updateReceiptsBadge() }
    unsubBroadcast = BlypShellTaxiBroadcast.subscribe { bindBroadcast() }
  }

  override fun onStop() {
    unsubRefresh?.invoke()
    unsubRefresh = null
    unsubBadges?.invoke()
    unsubBadges = null
    unsubBroadcast?.invoke()
    unsubBroadcast = null
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    BlypShellPerfMarks.start("tab_profile")
    bindProfile()
    view?.post { BlypShellPerfMarks.end("tab_profile") }
    val ctx = context ?: return
    BlypShellCommerceClient.refreshMeAsync(ctx) { ok ->
      if (ok) view?.post { bindProfile() }
    }
  }

  private fun bindProfile() {
    val root = view ?: return
    val ctx = context ?: return
    val profile = BlypShellSession.profile(ctx) ?: return
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    val amountFmt = NumberFormat.getIntegerInstance(locale)
    val commerceMode = BlypShellSession.isCommerceMode(ctx)
    val onboarding = BlypShellSession.needsOnboarding(ctx)
    val personalName = BlypShellCommerceSession.personalDisplayName(ctx).trim()
    val fallback = getString(R.string.blyp_shell_profile_account_fallback)
    val dash = getString(R.string.blyp_shell_profile_dash)
    val displayName =
      if (commerceMode) {
        BlypShellCommerceSession.strictCommerceName(ctx)
          .takeIf { it.isNotEmpty() && it != "—" && it != dash }
          ?: fallback
      } else {
        personalName.takeIf { it.isNotEmpty() && it != dash } ?: fallback
      }
    val accountName = personalName.takeIf { it.isNotEmpty() && it != dash } ?: dash

    root.findViewById<TextView>(R.id.blyp_profile_name).text = displayName
    root.findViewById<View>(R.id.blyp_profile_edit_name).visibility = View.GONE
    val editAccount = root.findViewById<View>(R.id.blyp_profile_edit_account)
    val canEdit = !onboarding && !commerceMode
    editAccount.visibility = if (canEdit) View.VISIBLE else View.GONE

    val chip = root.findViewById<TextView>(R.id.blyp_profile_status_chip)
    when {
      commerceMode -> {
        chip.visibility = View.VISIBLE
        chip.setText(R.string.blyp_shell_profile_mode_pro)
        chip.setBackgroundResource(R.drawable.blyp_shell_chip_ok)
        chip.setTextColor(ctx.getColor(R.color.blyp_shell_accent))
      }
      onboarding -> {
        chip.visibility = View.VISIBLE
        chip.setText(R.string.blyp_shell_profile_status_incomplete)
        chip.setBackgroundResource(R.drawable.blyp_shell_chip_warn)
        chip.setTextColor(ctx.getColor(R.color.blyp_shell_destructive))
      }
      else -> chip.visibility = View.GONE
    }

    root.findViewById<View>(R.id.blyp_profile_onboarding).visibility =
      if (onboarding) View.VISIBLE else View.GONE

    val balanceView = root.findViewById<TextView>(R.id.blyp_profile_balance)
    balanceView.text = amountFmt.format(profile.balanceFcfa)
    androidx.core.widget.TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(
      balanceView,
      14,
      28,
      1,
      android.util.TypedValue.COMPLEX_UNIT_SP,
    )
    val fullBalance = getString(R.string.blyp_shell_profile_balance_full, amountFmt.format(profile.balanceFcfa))
    root.findViewById<View>(R.id.blyp_profile_balance_card).setOnClickListener {
      BlypShellDialogs.alertBuilder(ctx)
        .setTitle(R.string.blyp_shell_profile_balance_label)
        .setMessage(fullBalance)
        .setPositiveButton(android.R.string.ok, null)
        .show()
    }
    root.findViewById<View>(R.id.blyp_profile_balance_actions).visibility =
      if (canEdit) View.VISIBLE else View.GONE
    root.findViewById<View>(R.id.blyp_profile_commerce_withdraw).visibility =
      if (commerceMode) View.VISIBLE else View.GONE

    val initial =
      displayName.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "?"
    val initialView = root.findViewById<TextView>(R.id.blyp_profile_avatar_initial)
    val imageView = root.findViewById<ImageView>(R.id.blyp_profile_avatar_image)
    initialView.text = initial
    val commercePhoto =
      if (commerceMode) {
        BlypShellCommerceSession.activeCommerceId(ctx)?.let {
          BlypShellCommerceSession.commerceAvatarFile(ctx, it)
        }
      } else {
        null
      }
    if (commercePhoto != null && commercePhoto.isFile) {
      imageView.setImageBitmap(android.graphics.BitmapFactory.decodeFile(commercePhoto.absolutePath))
      imageView.visibility = View.VISIBLE
      initialView.visibility = View.GONE
    } else if (commerceMode) {
      imageView.setImageDrawable(null)
      imageView.visibility = View.GONE
      initialView.visibility = View.VISIBLE
    } else {
      BlypShellAvatarLoader.loadInto(profile.avatarUrl, imageView, initialView, initial)
    }

    root.findViewById<TextView>(R.id.blyp_profile_phone_value).text = formatPhone(profile.phone)
    root.findViewById<TextView>(R.id.blyp_profile_name_value).text = accountName
    root.findViewById<TextView>(R.id.blyp_profile_id_value).text =
      BlypShellSession.accountId(ctx)?.trim()?.ifEmpty { null } ?: dash

    bindCommerces(root, amountFmt)
    bindToggles(root)
    bindKyc(root, profile.kycStatus, amountFmt)
    bindVersion(root)
    updateReceiptsBadge()
    BlypShellClicks.arm(root)
  }

  private fun bindCommerces(root: View, amountFmt: NumberFormat) {
    val ctx = context ?: return
    val list = root.findViewById<LinearLayout>(R.id.blyp_profile_commerces_list)
    val commerces = BlypShellCommerceSession.listCommerces(ctx)
    val personalActive = !BlypShellSession.isCommerceMode(ctx)
    val activeId = BlypShellCommerceSession.activeCommerceId(ctx)
    val personalName = BlypShellCommerceSession.personalDisplayName(ctx)
    val sig =
      buildString {
        append(personalName)
        append('|')
        append(personalActive)
        append('|')
        append(activeId)
        append('|')
        append(commerceBusyKey)
        commerces.forEach { append('|').append(it.id).append(it.name).append(it.balanceFcfa) }
      }
    if (sig == commercesSig && list.childCount > 0) {
      root.findViewById<View>(R.id.blyp_profile_commerces_empty).visibility =
        if (commerces.isEmpty()) View.VISIBLE else View.GONE
      return
    }
    commercesSig = sig
    list.removeAllViews()
    val inflater = layoutInflater
    list.addView(
      inflateCommerceRow(
        inflater,
        list,
        key = "personal",
        title = personalName,
        meta =
          getString(
            if (personalActive) R.string.blyp_shell_commerce_active_badge
            else R.string.blyp_shell_commerce_open,
          ),
        active = personalActive,
        onClick = { switchContext(personal = true, commerceId = null) },
      ),
    )
    commerces.forEach { c ->
      val active = !personalActive && c.id == activeId
      list.addView(
        inflateCommerceRow(
          inflater,
          list,
          key = c.id,
          title = BlypShellCommerceSession.withoutOwnerLastName(ctx, c.name),
          meta = "${amountFmt.format(c.balanceFcfa)} F",
          active = active,
          onClick = { switchContext(personal = false, commerceId = c.id) },
        ),
      )
    }
    root.findViewById<View>(R.id.blyp_profile_commerces_empty).visibility =
      if (commerces.isEmpty()) View.VISIBLE else View.GONE
  }

  private fun inflateCommerceRow(
    inflater: LayoutInflater,
    parent: LinearLayout,
    key: String,
    title: String,
    meta: String,
    active: Boolean,
    onClick: () -> Unit,
  ): View {
    val row = inflater.inflate(R.layout.blyp_shell_profile_commerce_row, parent, false)
    row.findViewById<TextView>(R.id.blyp_profile_commerce_title).text = title
    row.findViewById<TextView>(R.id.blyp_profile_commerce_meta).text = meta
    val busy = commerceBusyKey == key
    row.findViewById<View>(R.id.blyp_profile_commerce_busy).visibility =
      if (busy) View.VISIBLE else View.GONE
    row.findViewById<View>(R.id.blyp_profile_commerce_active).visibility =
      if (active && !busy) View.VISIBLE else View.GONE
    row.setBackgroundResource(
      if (active) R.drawable.blyp_shell_commerce_row_active else android.R.color.transparent,
    )
    val pad = ((if (active) 16 else 4) * row.resources.displayMetrics.density).toInt()
    row.setPadding(pad, row.paddingTop, pad, row.paddingBottom)
    row.isEnabled = commerceBusyKey == null
    row.setOnClickListener { onClick() }
    return row
  }

  private fun switchContext(personal: Boolean, commerceId: String?) {
    val ctx = context ?: return
    if (commerceBusyKey != null) return
    val already =
      if (personal) !BlypShellSession.isCommerceMode(ctx)
      else {
        BlypShellSession.isCommerceMode(ctx) &&
          BlypShellCommerceSession.activeCommerceId(ctx) == commerceId
      }
    if (already) return
    if (BlypShellSession.isCommerceMode(ctx)) {
      BlypShellTaxiBroadcast.stopImmediately(ctx)
    }
    commerceBusyKey = if (personal) "personal" else commerceId
    commercesSig = ""
    view?.let { bindCommerces(it, amountFmt()) }
    BlypShellCommerceClient.setActiveContextAsync(ctx, personal, commerceId) { outcome ->
      view?.post {
        commerceBusyKey = null
        commercesSig = ""
        val msg =
          when (outcome) {
            BlypShellCommerceClient.SwitchOutcome.Ok -> 0
            BlypShellCommerceClient.SwitchOutcome.Offline -> R.string.blyp_shell_switch_offline
            BlypShellCommerceClient.SwitchOutcome.Network -> R.string.blyp_shell_switch_network
            BlypShellCommerceClient.SwitchOutcome.Failed -> R.string.blyp_shell_commerce_switch_failed
          }
        if (msg != 0) {
          Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
        } else {
          (activity as? BlypNativeShellActivity)?.let { shell ->
            shell.ensurePayTabMatchesCommerceMode()
            shell.paintPayTabTitle()
            if (!personal) shell.openPayTab()
          }
        }
        bindProfile()
      }
    }
  }

  private fun bindToggles(root: View) {
    val ctx = context ?: return
    val announce = root.findViewById<SwitchCompat>(R.id.blyp_profile_announce_switch)
    if (announce.isChecked != PaymentAnnouncePrefs.isEnabled(ctx)) {
      announce.isChecked = PaymentAnnouncePrefs.isEnabled(ctx)
    }
    val small = root.findViewById<SwitchCompat>(R.id.blyp_profile_small_pay_switch)
    val smallOn = BlypShellSession.smallPayWithoutPin(ctx)
    if (small.isChecked != smallOn) small.isChecked = smallOn
    val quick = root.findViewById<SwitchCompat>(R.id.blyp_profile_quick_pay_switch)
    val quickOn = BlypShellQuickPayPref.isEnabled(ctx)
    if (quick.isChecked != quickOn) quick.isChecked = quickOn
    val ble = root.findViewById<SwitchCompat>(R.id.blyp_profile_ble_pay_switch)
    val bleOn = BlypShellBlePayPref.isEnabled(ctx)
    if (ble.isChecked != bleOn) ble.isChecked = bleOn
    bindBroadcast()
  }

  private fun bindBroadcast() {
    val root = view ?: return
    val ctx = context ?: return
    val snap = BlypShellTaxiBroadcast.snapshot(ctx)
    val sw = root.findViewById<SwitchCompat>(R.id.blyp_profile_warm_switch)
    if (sw.isChecked != snap.wantOn) sw.isChecked = snap.wantOn
    val row = root.findViewById<View>(R.id.blyp_profile_warm_row)
    row.alpha = if (snap.busy) 0.55f else 1f
    row.isEnabled = !snap.busy
  }

  private fun onBroadcastToggle() {
    val ctx = context ?: return
    val snap = BlypShellTaxiBroadcast.snapshot(ctx)
    if (snap.busy) return
    val next = !snap.wantOn
    if (next && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val perms =
        arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
      val missing =
        perms.any {
          ContextCompat.checkSelfPermission(ctx, it) != PackageManager.PERMISSION_GRANTED
        }
      if (missing) {
        blePermLauncher.launch(perms)
        return
      }
    }
    BlypShellTaxiBroadcast.setWantOn(ctx, next)
  }

  private fun onSmallPayToggle() {
    val ctx = context ?: return
    if (smallPayBusy) return
    val sw = view?.findViewById<SwitchCompat>(R.id.blyp_profile_small_pay_switch) ?: return
    val next = !sw.isChecked
    sw.isChecked = next
    BlypShellSession.persistSmallPayWithoutPin(ctx, next)
    smallPayBusy = true
    Thread {
      val ok = BlypShellProfileClient.setSmallPayWithoutPin(ctx, next)
      view?.post {
        smallPayBusy = false
        if (!ok) {
          BlypShellSession.persistSmallPayWithoutPin(ctx, !next)
          sw.isChecked = !next
          Toast.makeText(ctx, R.string.blyp_shell_profile_generic_error, Toast.LENGTH_SHORT).show()
        }
      }
    }.start()
  }

  private fun onBlePayToggle() {
    val ctx = context ?: return
    val sw = view?.findViewById<SwitchCompat>(R.id.blyp_profile_ble_pay_switch) ?: return
    val next = !sw.isChecked
    sw.isChecked = next
    BlypShellBlePayPref.setEnabled(ctx, next)
  }

  private fun onQuickPayToggle() {
    val ctx = context ?: return
    val sw = view?.findViewById<SwitchCompat>(R.id.blyp_profile_quick_pay_switch) ?: return
    val next = !sw.isChecked
    if (!next) {
      applyQuickPay(false)
      return
    }
    if (BlypShellPush.needsPermission(ctx)) {
      pendingQuickPayOn = true
      notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      return
    }
    applyQuickPay(true)
  }

  private fun applyQuickPay(enabled: Boolean) {
    val ctx = context ?: return
    val sw = view?.findViewById<SwitchCompat>(R.id.blyp_profile_quick_pay_switch) ?: return
    val ok = BlypShellQuickPayPref.setEnabled(ctx, enabled)
    sw.isChecked = ok && enabled
    if (enabled && !ok) {
      val msg =
        if (BlypShellPush.needsPermission(ctx)) {
          R.string.blyp_shell_profile_quick_pay_permission
        } else {
          R.string.blyp_shell_profile_quick_pay_vault
        }
      Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
    }
  }

  private fun lingerOutline(view: View) {
    val clear = Runnable { view.isActivated = false }
    view.setOnTouchListener { v, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          v.removeCallbacks(clear)
          v.isActivated = true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          v.removeCallbacks(clear)
          v.isActivated = true
          v.postDelayed(clear, 550)
        }
      }
      false
    }
  }

  private fun bindKyc(root: View, status: String, amountFmt: NumberFormat) {
    val block = root.findViewById<View>(R.id.blyp_profile_kyc_block)
    val pending = root.findViewById<TextView>(R.id.blyp_profile_kyc_pending)
    val cta = root.findViewById<TextView>(R.id.blyp_profile_kyc_cta)
    val lead = root.findViewById<TextView>(R.id.blyp_profile_kyc_lead)
    lead.setText(R.string.blyp_shell_profile_kyc_lead)
    when (status) {
      "approved" -> block.visibility = View.GONE
      "pending" -> {
        block.visibility = View.VISIBLE
        pending.visibility = View.VISIBLE
        cta.visibility = View.GONE
      }
      "rejected" -> {
        block.visibility = View.VISIBLE
        pending.visibility = View.GONE
        cta.visibility = View.VISIBLE
        cta.setText(R.string.blyp_shell_kyc_unlock)
      }
      else -> {
        block.visibility = View.VISIBLE
        pending.visibility = View.GONE
        cta.visibility = View.VISIBLE
        cta.setText(R.string.blyp_shell_kyc_verify)
      }
    }
  }

  private fun bindVersion(root: View) {
    val ctx = context ?: return
    val version =
      runCatching {
          ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName
        }
        .getOrNull()
        ?.trim()
        .orEmpty()
        .ifEmpty { getString(R.string.blyp_shell_profile_dash) }
    root.findViewById<TextView>(R.id.blyp_profile_version).text =
      getString(R.string.blyp_shell_profile_version, version)
  }

  private fun updateReceiptsBadge() {
    val root = view ?: return
    val ctx = context ?: return
    val badge = root.findViewById<TextView>(R.id.blyp_profile_receipts_badge) ?: return
    val n = BlypShellSession.receiptsUnread(ctx)
    if (n <= 0) {
      badge.visibility = View.GONE
      return
    }
    badge.visibility = View.VISIBLE
    badge.text = if (n > 99) "99+" else n.toString()
  }

  private fun uploadAvatar(uri: Uri) {
    val ctx = context ?: return
    if (avatarBusy) return
    if (BlypShellSession.isCommerceMode(ctx)) {
      val id = BlypShellCommerceSession.activeCommerceId(ctx)
      val dest = id?.let { BlypShellCommerceSession.commerceAvatarFile(ctx, it) }
      val copied = copyPickToCache(uri)
      if (dest == null || copied == null) {
        Toast.makeText(ctx, R.string.blyp_shell_profile_photo_failed, Toast.LENGTH_SHORT).show()
        return
      }
      dest.parentFile?.mkdirs()
      copied.copyTo(dest, overwrite = true)
      bindProfile()
      return
    }
    val file = copyPickToCache(uri) ?: run {
      Toast.makeText(ctx, R.string.blyp_shell_profile_photo_failed, Toast.LENGTH_SHORT).show()
      return
    }
    avatarBusy = true
    view?.findViewById<View>(R.id.blyp_profile_avatar_busy)?.visibility = View.VISIBLE
    Thread {
      val ok = BlypShellProfileClient.uploadAvatar(ctx, file, "image/jpeg")
      view?.post {
        avatarBusy = false
        view?.findViewById<View>(R.id.blyp_profile_avatar_busy)?.visibility = View.GONE
        Toast.makeText(
            ctx,
            if (ok) R.string.blyp_shell_profile_photo_updated
            else R.string.blyp_shell_profile_photo_failed,
            Toast.LENGTH_SHORT,
          )
          .show()
        if (ok) bindProfile()
      }
    }.start()
  }

  private fun copyPickToCache(uri: Uri): File? {
    val ctx = context ?: return null
    return try {
      val out = File(ctx.cacheDir, "avatar-pick-${System.currentTimeMillis()}.jpg")
      ctx.contentResolver.openInputStream(uri)?.use { input ->
        out.outputStream().use { output -> input.copyTo(output) }
      }
      out.takeIf { it.length() > 0 }
    } catch (_: Exception) {
      null
    }
  }

  private fun confirmSignOut() {
    val ctx = context ?: return
    BlypShellDialogs.alertBuilder(ctx)
      .setTitle(R.string.blyp_shell_sign_out_title)
      .setMessage(R.string.blyp_shell_sign_out_message)
      .setNegativeButton(R.string.blyp_shell_sign_out_cancel, null)
      .setPositiveButton(R.string.blyp_shell_sign_out_confirm) { _, _ -> onSignOut() }
      .show()
  }

  private fun onSignOut() {
    val ctx = context ?: return
    BlypShellAuthSignOut.perform(ctx)
    ShellSignInActivity.startFresh(ctx)
    activity?.finish()
  }

  private fun categoryLabel(category: String): String =
    when (category) {
      "taxi" -> getString(R.string.blyp_shell_commerce_cat_taxi)
      "shop" -> getString(R.string.blyp_shell_commerce_cat_shop)
      "soa_car" -> getString(R.string.blyp_shell_commerce_cat_soa)
      "street" -> getString(R.string.blyp_shell_commerce_cat_street)
      else -> getString(R.string.blyp_shell_commerce_cat_other)
    }

  private fun formatPhone(digits: String): String {
    val d = digits.replace(Regex("\\D"), "")
    if (d.length == 9) {
      return "+237 ${d.substring(0, 3)} ${d.substring(3, 6)} ${d.substring(6)}"
    }
    return if (d.startsWith("237") && d.length >= 12) "+$d" else d.ifEmpty { getString(R.string.blyp_shell_profile_dash) }
  }

  private fun amountFmt(): NumberFormat {
    val locale = if (Locale.getDefault().language == "fr") Locale.FRENCH else Locale.US
    return NumberFormat.getIntegerInstance(locale)
  }

  private fun tintSwitch(sw: SwitchCompat) {
    val ctx = context ?: return
    val trackOn = ctx.getColor(R.color.blyp_shell_switch_track_on)
    val trackOff = ctx.getColor(R.color.blyp_shell_switch_track_off)
    val thumb = ctx.getColor(R.color.blyp_shell_switch_thumb)
    sw.trackTintList =
      ColorStateList(
        arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
        intArrayOf(trackOn, trackOff),
      )
    sw.thumbTintList = ColorStateList.valueOf(thumb)
  }

  private fun clipAvatar(wrap: View) {
    wrap.outlineProvider =
      object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
          if (view.width <= 0 || view.height <= 0) return
          outline.setOval(0, 0, view.width, view.height)
        }
      }
    wrap.clipToOutline = true
  }
}
