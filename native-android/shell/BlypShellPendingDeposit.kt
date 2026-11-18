package com.haroldndougou.blyp.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** Poll MoMo en fond après dépôt natif (équivalent pendingWatch JS). */
object BlypShellPendingDeposit {
  private const val PREFS = "blyp_shell_pending_deposit_v1"
  private const val KEY_JSON = "watch_json"
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var pollGen = 0

  fun arm(context: Context, depositIntentId: String, amountFcfa: Int) {
    val o =
      JSONObject().apply {
        put("depositIntentId", depositIntentId.trim())
        put("amountFcfa", amountFcfa)
        put("checks", 0)
      }
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_JSON, o.toString())
      .apply()
    schedulePoll(context.applicationContext, ++pollGen)
  }

  fun tick(context: Context) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_JSON, "").orEmpty().trim()
    if (raw.isEmpty()) return
    val o = runCatching { JSONObject(raw) }.getOrNull() ?: return
    val id = o.optString("depositIntentId", "").trim()
    if (id.isEmpty()) {
      clear(context)
      return
    }
    val checks = o.optInt("checks", 0)
    val syncRemote = checks >= 2 && checks % 2 == 0
    val status = BlypShellDepositExecutor.statusSync(context, id, syncRemote)
    when (status.status) {
      "completed" -> {
        clear(context)
        BlypShellUiRefresh.notifyWalletChanged()
      }
      "failed" -> clear(context)
      else -> {
        o.put("checks", checks + 1)
        if (checks > 28) {
          clear(context)
        } else {
          prefs.edit().putString(KEY_JSON, o.toString()).apply()
        }
      }
    }
  }

  private fun schedulePoll(context: Context, gen: Int) {
    main.postDelayed(
      {
        if (gen != pollGen) return@postDelayed
        tick(context)
        val still =
          context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_JSON, "")
            .orEmpty()
            .isNotBlank()
        if (still) schedulePoll(context, gen)
      },
      650L,
    )
  }

  private fun clear(context: Context) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_JSON)
      .apply()
  }
}
