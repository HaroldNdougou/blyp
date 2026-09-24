package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Monte temporairement alarme + média au max pendant l’annonce (taxi bruyant).
 * Restaure les niveaux utilisateur à la fin.
 */
object PaymentAnnounceVolume {
  /** TTS + cash — canal alarme (souvent le plus haut en voiture). */
  const val TTS_STREAM = AudioManager.STREAM_ALARM

  private val BOOST_STREAMS =
    intArrayOf(
      AudioManager.STREAM_ALARM,
      AudioManager.STREAM_MUSIC,
    )

  class Session(context: Context) {
    private val am =
      context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val savedVolumes = IntArray(BOOST_STREAMS.size)
    private var released = false
    private var focusRequest: AudioFocusRequest? = null

    init {
      for (i in BOOST_STREAMS.indices) {
        val stream = BOOST_STREAMS[i]
        savedVolumes[i] = am.getStreamVolume(stream)
        val max = am.getStreamMaxVolume(stream)
        if (max > 0) {
          am.setStreamVolume(stream, max, 0)
        }
      }
      requestFocus(am)
    }

    fun release() {
      if (released) return
      released = true
      abandonFocus(am)
      for (i in BOOST_STREAMS.indices) {
        try {
          am.setStreamVolume(BOOST_STREAMS[i], savedVolumes[i], 0)
        } catch (_: Exception) {
          /* ignore */
        }
      }
    }

    private fun requestFocus(am: AudioManager) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val attrs =
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val req =
          AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .setAcceptsDelayedFocusGain(false)
            .build()
        focusRequest = req
        am.requestAudioFocus(req)
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(
          null,
          TTS_STREAM,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
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

  fun begin(context: Context): Session = Session(context)
}
