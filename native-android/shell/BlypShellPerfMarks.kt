package com.haroldndougou.blyp.shell

import android.os.SystemClock
import android.util.Log
import com.haroldndougou.blyp.BuildConfig

/** Mesures perf coque — logs `BlypPerf` en debug (aligné `lib/perf/marks.ts`). */
object BlypShellPerfMarks {
  private const val TAG = "BlypPerf"
  private val open = HashMap<String, Long>()

  fun start(name: String) {
    if (!BuildConfig.DEBUG) return
    open[name] = SystemClock.elapsedRealtime()
  }

  fun end(name: String): Long? {
    if (!BuildConfig.DEBUG) return null
    val t0 = open.remove(name) ?: return null
    val ms = SystemClock.elapsedRealtime() - t0
    Log.d(TAG, "$name: ${ms}ms")
    return ms
  }

  fun lap(parent: String, label: String) {
    if (!BuildConfig.DEBUG) return
    val t0 = open[parent] ?: return
    Log.d(TAG, "$parent→$label: ${SystemClock.elapsedRealtime() - t0}ms")
  }
}
