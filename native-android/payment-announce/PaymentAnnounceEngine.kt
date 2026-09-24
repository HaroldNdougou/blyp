package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * TTS pré-chargé — volume max temporaire (alarme + média), voix seule.
 */
object PaymentAnnounceEngine {
  private var tts: TextToSpeech? = null
  private val ready = AtomicBoolean(false)
  private val warming = AtomicBoolean(false)
  private val pending = mutableListOf<() -> Unit>()

  fun warm(context: Context) {
    if (ready.get() || !warming.compareAndSet(false, true)) return
    val app = context.applicationContext
    tts =
      TextToSpeech(app) { status ->
        if (status != TextToSpeech.SUCCESS) {
          warming.set(false)
          return@TextToSpeech
        }
        ready.set(true)
        warming.set(false)
        val batch = synchronized(pending) {
          pending.toList().also { pending.clear() }
        }
        batch.forEach { it() }
      }
  }

  fun shutdown() {
    ready.set(false)
    warming.set(false)
    synchronized(pending) { pending.clear() }
    tts?.shutdown()
    tts = null
  }

  fun announce(
    context: Context,
    amountFcfa: Int,
    lang: String,
    onFinished: () -> Unit,
  ) {
    val run = {
      val app = context.applicationContext
      val volume = PaymentAnnounceVolume.begin(app)
      val finishAll = {
        volume.release()
        onFinished()
      }
      speakAmount(app, amountFcfa, lang, finishAll)
    }
    if (ready.get()) {
      run()
    } else {
      warm(context)
      synchronized(pending) { pending.add(run) }
    }
  }

  private fun speakAmount(
    context: Context,
    amountFcfa: Int,
    lang: String,
    onFinished: () -> Unit,
  ) {
    val engine = tts ?: run {
      onFinished()
      return
    }
    val locale = if (lang == "fr") Locale.FRANCE else Locale.US
    engine.language = locale
    pickMaleVoice(engine, locale)
    val formatted =
      NumberFormat.getNumberInstance(locale).format(amountFcfa.coerceAtLeast(0))
    val line =
      if (lang == "fr") "$formatted francs" else "$formatted CFA"
    val utteranceId = "blyp-pay-${System.currentTimeMillis()}"
    val settled = AtomicBoolean(false)
    val finishOnce = {
      if (settled.compareAndSet(false, true)) onFinished()
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      engine.setOnUtteranceProgressListener(
        object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}

          override fun onDone(utteranceId: String?) {
            finishOnce()
          }

          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String?) {
            finishOnce()
          }

          override fun onError(utteranceId: String?, errorCode: Int) {
            finishOnce()
          }
        },
      )
      val params =
        Bundle().apply {
          putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, PaymentAnnounceVolume.TTS_STREAM)
          putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f)
        }
      engine.speak(line, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
    } else {
      @Suppress("DEPRECATION")
      val params =
        HashMap<String, String>().apply {
          put(TextToSpeech.Engine.KEY_PARAM_STREAM, PaymentAnnounceVolume.TTS_STREAM.toString())
          put(TextToSpeech.Engine.KEY_PARAM_VOLUME, "1.0")
        }
      engine.speak(line, TextToSpeech.QUEUE_FLUSH, params)
      finishOnce()
    }
  }

  private fun pickMaleVoice(engine: TextToSpeech, locale: Locale) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
    val voices = engine.voices ?: return
    val prefix = locale.language.lowercase()
    val pool = voices.filter { it.locale.language.equals(prefix, ignoreCase = true) }
    val male =
      pool.firstOrNull { v ->
        val id = v.name.lowercase()
        id.contains("male") || id.contains("homme") || id.contains("frm") || id.contains("gbm")
      }
    if (male != null) {
      engine.voice = male
    }
  }
}
