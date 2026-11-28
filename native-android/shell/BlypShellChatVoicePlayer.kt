package com.haroldndougou.blyp.shell

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.ArrayDeque

object BlypShellChatVoicePlayer {
  data class ChainItem(
    val messageId: String,
    val conversationId: String,
    val voiceKey: String,
    val localPath: String?,
  )

  private val main = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  @Volatile private var playingMessageId: String? = null
  private var globalRate = 1f
  private val listeners = LinkedHashSet<(String?, Boolean) -> Unit>()
  private var progress: ((String, Int, Int, Boolean, Float) -> Unit)? = null
  private var composerProgress: ((String, Int, Int, Boolean, Float) -> Unit)? = null
  private var playStartedAt = 0L
  private var rewound = false
  private val chain = ArrayDeque<ChainItem>()
  private var chainContext: Context? = null
  private var chainOnStep: ((String) -> Unit)? = null
  private var chainOnError: (() -> Unit)? = null
  private var duckContext: Context? = null
  private val ticker =
    object : Runnable {
      override fun run() {
        val id = playingMessageId ?: return
        val mp = player ?: return
        val playing = runCatching { mp.isPlaying }.getOrDefault(false)
        var pos = runCatching { mp.currentPosition }.getOrDefault(0)
        val dur = runCatching { mp.duration }.getOrDefault(0)
        if (
          playing &&
            !rewound &&
            android.os.SystemClock.elapsedRealtime() - playStartedAt < 800L &&
            dur > 800 &&
            pos > dur * 0.8
        ) {
          runCatching { mp.seekTo(0) }
          pos = 0
          rewound = true
        }
        progress?.invoke(id, pos, dur, playing, rateFor(id))
        composerProgress?.invoke(id, pos, dur, playing, rateFor(id))
        if (playing) main.postDelayed(this, 120)
      }
    }

  fun subscribe(listener: (String?, Boolean) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun setProgressListener(listener: ((String, Int, Int, Boolean, Float) -> Unit)?) {
    progress = listener
  }

  fun setComposerProgress(listener: ((String, Int, Int, Boolean, Float) -> Unit)?) {
    composerProgress = listener
  }

  fun rateFor(messageId: String): Float = globalRate

  fun cycleRate(messageId: String): Float {
    globalRate =
      when (globalRate) {
        1f -> 1.5f
        1.5f -> 2f
        else -> 1f
      }
    if (player != null) applyRate(player, globalRate)
    return globalRate
  }

  fun seekTo(ms: Int) {
    runCatching { player?.seekTo(ms.coerceAtLeast(0)) }
    main.post(ticker)
  }

  fun pausePlayback() {
    runCatching { player?.pause() }
    main.removeCallbacks(ticker)
    duckContext?.let { BlypShellChatVoiceDuck.leave(it) }
    clearChain()
    notifyListeners()
    val id = playingMessageId ?: return
    val mp = player ?: return
    val pos = runCatching { mp.currentPosition }.getOrDefault(0)
    val dur = runCatching { mp.duration }.getOrDefault(0)
    progress?.invoke(id, pos, dur, false, rateFor(id))
    composerProgress?.invoke(id, pos, dur, false, rateFor(id))
  }

  private fun audioAttrs(): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()

  fun canResume(messageId: String): Boolean =
    playingMessageId == messageId && player != null && player?.isPlaying != true

  fun resumePlayback() {
    duckContext?.let { BlypShellChatVoiceDuck.enter(it) }
    runCatching { player?.start() }
    notifyListeners()
    main.post(ticker)
  }

  fun play(file: File, messageId: String, onError: () -> Unit) {
    if (!file.isFile || file.length() < 200) {
      onError()
      return
    }
    if (canResume(messageId)) {
      resumePlayback()
      return
    }
    stop()
    playFile(file, messageId, onError)
  }

  fun isPlaying(messageId: String): Boolean =
    playingMessageId == messageId && player?.isPlaying == true

  fun activeId(): String? = playingMessageId

  fun positionMs(): Int = runCatching { player?.currentPosition ?: 0 }.getOrDefault(0)

  fun prefetch(context: Context, conversationId: String, voiceKey: String?) {
    val key = voiceKey?.trim().orEmpty()
    if (key.isEmpty() || key.equals("null", true)) return
    val app = context.applicationContext
    Thread { runCatching { ensureCached(app, conversationId, key) } }.start()
  }

  fun playWithChain(
    context: Context,
    conversationId: String,
    messageId: String,
    voiceKey: String,
    localPath: String?,
    chainRest: List<ChainItem>,
    onStep: ((String) -> Unit)?,
    onError: () -> Unit,
  ) {
    releasePlaybackOnly()
    chainContext = context.applicationContext
    duckContext = context.applicationContext
    chain.clear()
    chain.addAll(chainRest)
    chainOnStep = onStep
    chainOnError = onError
    beginMessage(context, conversationId, messageId, voiceKey, localPath, onError)
  }

  fun toggleFile(context: Context, messageId: String, file: File, onError: () -> Unit) {
    duckContext = context.applicationContext
    if (!file.isFile || file.length() < 200) {
      onError()
      return
    }
    if (playingMessageId == messageId && player?.isPlaying == true) {
      stop()
      return
    }
    stop()
    playFile(file, messageId, onError)
  }

  fun toggle(
    context: Context,
    conversationId: String,
    messageId: String,
    voiceKey: String,
    localPath: String?,
    onError: () -> Unit,
  ) {
    duckContext = context.applicationContext
    if (playingMessageId == messageId && player?.isPlaying == true) {
      pausePlayback()
      return
    }
    if (canResume(messageId)) {
      resumePlayback()
      return
    }
    stop()
    beginMessage(context, conversationId, messageId, voiceKey, localPath, onError)
  }

  private fun beginMessage(
    context: Context,
    conversationId: String,
    messageId: String,
    voiceKey: String,
    localPath: String?,
    onError: () -> Unit,
  ) {
    val local = localPath?.trim().orEmpty()
    val localFile = if (local.isNotEmpty()) File(local) else null
    if (localFile != null && localFile.isFile && localFile.length() > 200) {
      playFile(localFile, messageId, onError)
      return
    }
    val key = voiceKey.trim()
    if (key.isEmpty() || key.equals("null", true)) {
      onError()
      tryAdvanceChainOnError()
      return
    }
    val app = context.applicationContext
    Thread {
        val file = ensureCached(app, conversationId, key)
        main.post {
          if (file == null) {
            onError()
            tryAdvanceChainOnError()
          } else {
            playFile(file, messageId, onError)
          }
        }
      }
      .start()
  }

  private fun playFile(file: File, messageId: String, onError: () -> Unit) {
    val duck = duckContext ?: chainContext
    try {
      duck?.let { BlypShellChatVoiceDuck.enter(it) }
      val mp = MediaPlayer()
      mp.setAudioAttributes(audioAttrs())
      mp.setDataSource(file.absolutePath)
      mp.setOnCompletionListener {
        val id = playingMessageId
        val more = chain.isNotEmpty() && chainContext != null
        releasePlaybackOnly(restoreAudio = !more)
        notifyListeners()
        if (id != null) {
          progress?.invoke(id, 0, 0, false, rateFor(id))
          composerProgress?.invoke(id, 0, 0, false, rateFor(id))
        }
        if (more) {
          playNextInChain()
        } else {
          clearChain()
        }
      }
      mp.prepare()
      mp.setVolume(1f, 1f)
      val speed = rateFor(messageId)
      mp.start()
      if (speed != 1f) applyRate(mp, speed)
      mp.seekTo(0)
      player = mp
      playingMessageId = messageId
      playStartedAt = android.os.SystemClock.elapsedRealtime()
      rewound = false
      notifyListeners()
      main.post(ticker)
    } catch (_: Exception) {
      duck?.let { BlypShellChatVoiceDuck.leave(it) }
      onError()
      tryAdvanceChainOnError()
    }
  }

  private fun playNextInChain() {
    val ctx = chainContext ?: run {
      clearChain()
      return
    }
    val next = chain.removeFirst()
    chainOnStep?.invoke(next.messageId)
    beginMessage(
      ctx,
      next.conversationId,
      next.messageId,
      next.voiceKey,
      next.localPath,
      chainOnError ?: {},
    )
  }

  private fun tryAdvanceChainOnError() {
    if (chain.isNotEmpty() && chainContext != null) playNextInChain() else clearChain()
  }

  private fun applyRate(mp: MediaPlayer?, speed: Float) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    runCatching {
      mp?.playbackParams = PlaybackParams().setPitch(1f).setSpeed(speed)
    }
  }

  private fun releasePlaybackOnly(restoreAudio: Boolean = true) {
    if (restoreAudio) {
      (duckContext ?: chainContext)?.let { BlypShellChatVoiceDuck.leave(it) }
    }
    main.removeCallbacks(ticker)
    try {
      player?.stop()
    } catch (_: Exception) {
    }
    try {
      player?.release()
    } catch (_: Exception) {
    }
    player = null
    playingMessageId = null
  }

  private fun clearChain() {
    chain.clear()
    chainContext = null
    chainOnStep = null
    chainOnError = null
  }

  fun stop() {
    releasePlaybackOnly()
    clearChain()
    notifyListeners()
  }

  fun release() = stop()

  private fun notifyListeners() {
    val id = playingMessageId
    val playing = player?.isPlaying == true
    main.post {
      for (l in listeners) {
        runCatching { l(id, playing) }
      }
    }
  }

  private fun ensureCached(context: Context, conversationId: String, key: String): File? {
    val dir = File(context.applicationContext.cacheDir, "blyp-voice")
    dir.mkdirs()
    val dest = File(dir, "${keyHash(key)}.m4a")
    if (dest.isFile && dest.length() > 400) return dest
    val presign =
      BlypShellChatPresign.post(
        context,
        conversationId,
        JSONObject().put("type", "voice-play").put("key", key),
      ) ?: return null
    val url = presign.optString("url").trim()
    if (url.isEmpty() || url.equals("null", true)) return null
    return if (BlypShellChatPresign.downloadUrl(url, dest)) dest else null
  }

  private fun keyHash(key: String): String {
    val d = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
    return d.joinToString("") { "%02x".format(it) }.take(24)
  }
}