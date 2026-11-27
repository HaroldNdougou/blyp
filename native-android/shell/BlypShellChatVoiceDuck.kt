package com.haroldndougou.blyp.shell

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/** Coupe la musique du téléphone pendant enregistrement / lecture vocale, puis restaure. */
object BlypShellChatVoiceDuck {
  private var depth = 0
  private var savedMusic = -1
  private var focusRequest: AudioFocusRequest? = null

  @Synchronized
  fun enter(context: Context) {
    val app = context.applicationContext
    if (depth == 0) {
      val am = app.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
      savedMusic = am.getStreamVolume(AudioManager.STREAM_MUSIC)
      runCatching { am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0) }
      requestFocus(am)
    }
    depth++
  }

  @Synchronized
  fun leave(context: Context) {
    if (depth <= 0) return
    depth--
    if (depth > 0) return
    val am =
      context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return
    abandonFocus(am)
    if (savedMusic >= 0) {
      runCatching { am.setStreamVolume(AudioManager.STREAM_MUSIC, savedMusic, 0) }
      savedMusic = -1
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
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attrs)
          .setWillPauseWhenDucked(true)
          .setAcceptsDelayedFocusGain(false)
          .build()
      focusRequest = req
      am.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        null,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
      )
    }
  }

  private fun abandonFocus(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(null)
    }
    focusRequest = null
  }
}