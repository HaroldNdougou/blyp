package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Volume max temporaire (alarme / média) — audible taxi, restauré après annonce.
 */
object PaymentAnnounceAudio {
  private var savedVolume: Int? = null
  private var savedStream: Int? = null
  private var focusRequest: AudioFocusRequest? = null

  /** @return stream Android utilisé pour cash + TTS */
  fun arm(context: Context): Int {
    release(context)
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val stream = pickStream(am)
    savedStream = stream
    savedVolume = am.getStreamVolume(stream)
    val max = am.getStreamMaxVolume(stream)
    am.setStreamVolume(stream, max, 0)
    requestFocus(am, stream)
    return stream
  }

  fun release(context: Context) {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    abandonFocus(am)
    val prev = savedVolume
    val stream = savedStream
    if (prev != null && stream != null) {
      try {
        am.setStreamVolume(stream, prev.coerceAtLeast(0), 0)
      } catch (_: Exception) {
        /* ignore */
      }
    }
    savedVolume = null
    savedStream = null
  }

  fun cashAudioAttributes(): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

  private fun pickStream(am: AudioManager): Int {
    val alarm = AudioManager.STREAM_ALARM
    val music = AudioManager.STREAM_MUSIC
    if (am.getStreamVolume(alarm) > 0 || am.getStreamMaxVolume(alarm) > 0) {
      return alarm
    }
    return music
  }

  private fun requestFocus(am: AudioManager, stream: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs =
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      focusRequest =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(attrs)
          .setAcceptsDelayedFocusGain(false)
          .build()
      am.requestAudioFocus(focusRequest!!)
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        null,
        stream,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
      )
    }
  }

  private fun abandonFocus(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(null)
    }
  }
}
