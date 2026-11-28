package com.haroldndougou.blyp.shell

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Pendant un vocal : baisse la musique, monte le flux voix, puis restaure
 * exactement les volumes d’avant (une seule prise / une seule restitution).
 */
object BlypShellChatVoiceDuck {
  private var held = false
  private var savedMusic = -1
  private var savedVoice = -1
  private var focusRequest: AudioFocusRequest? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { }

  @Synchronized
  fun enter(context: Context) {
    if (held) return
    val am =
      context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return
    savedMusic = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    savedVoice = am.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
    runCatching { requestFocus(am) }
    val maxMusic = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val maxVoice = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
    val ducked =
      when {
        savedMusic <= 0 -> 0
        else -> (savedMusic * 0.22f).toInt().coerceIn(0, (savedMusic - 1).coerceAtLeast(0))
      }.coerceAtMost(maxMusic)
    runCatching { am.setStreamVolume(AudioManager.STREAM_MUSIC, ducked, 0) }
    val boost = maxOf(savedVoice, (maxVoice * 0.88f).toInt()).coerceIn(0, maxVoice)
    runCatching { am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, boost, 0) }
    held = true
  }

  @Synchronized
  fun leave(context: Context) {
    if (!held) return
    held = false
    val am =
      context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return
    abandonFocus(am)
    if (savedMusic >= 0) {
      runCatching { am.setStreamVolume(AudioManager.STREAM_MUSIC, savedMusic, 0) }
      savedMusic = -1
    }
    if (savedVoice >= 0) {
      runCatching { am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, savedVoice, 0) }
      savedVoice = -1
    }
  }

  private fun requestFocus(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs =
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      val req =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(attrs)
          .setOnAudioFocusChangeListener(focusListener)
          .setWillPauseWhenDucked(false)
          .build()
      focusRequest = req
      am.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        focusListener,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
      )
    }
  }

  private fun abandonFocus(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(focusListener)
    }
    focusRequest = null
  }
}
