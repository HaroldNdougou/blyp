package com.haroldndougou.blyp.shell

import android.content.Context

/** URL avatar CDN `avatars/{9digits}.jpg` (aligné `lib/peers/peerAvatarUrl.ts`). */
object BlypShellPeerAvatar {
  fun urlForPhone(context: Context, phone: String?): String? {
    val key = phoneDigitsForAvatar(phone) ?: return null
    val base = BlypShellRuntime.assetsCdnBase(context).trimEnd('/')
    if (base.isBlank()) return null
    return "$base/avatars/$key.jpg"
  }

  fun phoneDigitsForAvatar(phone: String?): String? {
    val d = phone?.replace(Regex("\\D"), "").orEmpty()
    if (d.isEmpty()) return null
    val nine = if (d.length >= 9) d.takeLast(9) else d
    if (Regex("^6\\d{8}$").matches(nine)) return nine
    if (d.length in 8..15) return d
    return null
  }
}
