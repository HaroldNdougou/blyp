package com.haroldndougou.blyp.paymentannounce

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
  @Volatile private var preparedLang: String? = null

  /** Langue + voix choisies une fois au préchargement (lent : ~1–2 s). */
  private fun prepareVoice(context: Context) {
    val engine = tts ?: return
    val lang = PaymentAnnouncePrefs.getLang(context)
    val locale = if (lang == "fr") Locale.FRANCE else Locale.US
    runCatching {
      engine.language = locale
      pickMaleVoice(engine, locale)
      preparedLang = lang
      val silent =
        Bundle().apply {
          putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, PaymentAnnounceVolume.TTS_STREAM)
          putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 0f)
        }
      engine.speak(if (lang == "fr") "0 francs" else "0 CFA", TextToSpeech.QUEUE_ADD, silent, "blyp-warm")
    }
  }

  @Volatile var lastRequestAt = 0L

  private fun perf(msg: String) {
    if (com.haroldndougou.blyp.BuildConfig.DEBUG) {
      val dt = android.os.SystemClock.elapsedRealtime() - lastRequestAt
      android.util.Log.d("BlypPerf", "announce_$msg: ${dt}ms")
    }
  }

  fun warm(context: Context) {
    if (ready.get() || !warming.compareAndSet(false, true)) return
    val app = context.applicationContext
    tts =
      TextToSpeech(app) { status ->
        if (status != TextToSpeech.SUCCESS) {
          warming.set(false)
          return@TextToSpeech
        }
        Thread {
          prepareVoice(app)
          ready.set(true)
          warming.set(false)
          val batch = synchronized(pending) {
            pending.toList().also { pending.clear() }
          }
          batch.forEach { it() }
        }.start()
      }
  }

  private const val KEEP_WARM_MS = 120_000L
  private val keepHandler = Handler(Looper.getMainLooper())
  @Volatile private var keepCtx: Context? = null

  private val keepTick =
    object : Runnable {
      override fun run() {
        val ctx = keepCtx ?: return
        if (!PaymentAnnouncePrefs.isEnabled(ctx)) {
          stopKeepWarm()
          return
        }
        pingSilently(ctx)
        keepHandler.postDelayed(this, KEEP_WARM_MS)
      }
    }

  /** Caisse « En ligne » : le moteur vocal reste réveillé (synthèse muette, rien n’est joué). */
  fun startKeepWarm(context: Context) {
    val app = context.applicationContext
    warm(app)
    if (keepCtx != null) return
    keepCtx = app
    keepHandler.postDelayed(keepTick, KEEP_WARM_MS)
  }

  fun stopKeepWarm() {
    keepCtx = null
    keepHandler.removeCallbacks(keepTick)
  }

  private fun pingSilently(context: Context) {
    val engine = tts
    if (engine == null || !ready.get()) {
      warm(context)
      return
    }
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    if (audio?.isMusicActive == true) return
    val out = java.io.File(context.cacheDir, "blyp-tts-keep.wav")
    val ok =
      runCatching {
        engine.synthesizeToFile(
          if (preparedLang == "fr") "0 francs" else "0 CFA",
          Bundle(),
          out,
          "blyp-keep",
        ) == TextToSpeech.SUCCESS
      }.getOrDefault(false)
    if (!ok) {
      shutdown()
      warm(context)
    }
  }

  fun shutdown() {
    ready.set(false)
    warming.set(false)
    preparedLang = null
    synchronized(pending) { pending.clear() }
    tts?.shutdown()
    tts = null
  }

  fun announce(
    context: Context,
    amountFcfa: Int,
    lang: String,
    payerName: String? = null,
    onFinished: () -> Unit,
  ) {
    perf("engine ready=${ready.get()}")
    val run = {
      val app = context.applicationContext
      val volume = PaymentAnnounceVolume.begin(app)
      val finishAll = {
        volume.release()
        onFinished()
      }
      speakAmount(app, amountFcfa, lang, payerName, finishAll)
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
    payerName: String?,
    onFinished: () -> Unit,
  ) {
    val engine = tts ?: run {
      onFinished()
      return
    }
    val locale = if (lang == "fr") Locale.FRANCE else Locale.US
    if (preparedLang != lang) {
      engine.language = locale
      pickMaleVoice(engine, locale)
      preparedLang = lang
    }
    val formatted =
      NumberFormat.getNumberInstance(locale).format(amountFcfa.coerceAtLeast(0))
    val line = if (lang == "fr") "$formatted francs" else "$formatted CFA"
    val utteranceId = "blyp-pay-${System.currentTimeMillis()}"
    val settled = AtomicBoolean(false)
    val finishOnce = {
      if (settled.compareAndSet(false, true)) onFinished()
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      engine.setOnUtteranceProgressListener(
        object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {
            perf("speak_start")
          }

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
