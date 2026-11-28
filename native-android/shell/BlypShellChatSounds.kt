package com.haroldndougou.blyp.shell

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper

/** Souffle à l’envoi, trois notes à l’arrivée. Déjà en mémoire, muet si le téléphone est silencieux. */
object BlypShellChatSounds {
  private const val RATE = 22050
  private val main = Handler(Looper.getMainLooper())
  private val gate = Any()
  @Volatile private var started = false
  @Volatile private var receiveTrack: AudioTrack? = null
  @Volatile private var sendPcm: ShortArray? = null
  @Volatile private var sendTrack: AudioTrack? = null
  @Volatile private var claimPcm: ShortArray? = null
  @Volatile private var claimTrack: AudioTrack? = null
  private var pendingClaim = false
  private var pendingSend = false
  private var pendingReceive = false
  private var sendApp: Context? = null

  fun warm(context: Context? = null) {
    if (context != null) sendApp = context.applicationContext
    if (started) return
    val app = sendApp
    synchronized(gate) {
      if (started) return
      started = true
    }
    Thread {
      val clip = pad(app?.let { loadWhoosh(it) } ?: whoosh())
      val claimClip = pad(cheer())
      val receivePcm = pad(notes())
      val reactClip = reactBlip()
      main.post {
        sendPcm = clip
        claimPcm = claimClip
        reactPcm = reactClip
        receiveTrack = track(receivePcm)
        if (pendingSend) {
          pendingSend = false
          sendApp?.let { playSendNow(it) }
        }
        if (pendingClaim) {
          pendingClaim = false
          sendApp?.let { playClaimNow(it) }
        }
        if (pendingReceive) {
          pendingReceive = false
          replay(receiveTrack)
        }
        if (pendingReact) {
          pendingReact = false
          sendApp?.let { playReactNow(it) }
        }
      }
    }.start()
  }

  fun playSend(context: Context) {
    sendApp = context.applicationContext
    warm(context)
    val run = Runnable { playSendNow(sendApp ?: return@Runnable) }
    if (Looper.myLooper() == Looper.getMainLooper()) run.run() else main.post(run)
  }

  private fun playSendNow(context: Context) {
    if (ringerSilent(context)) return
    val pcm = sendPcm
    if (pcm == null) {
      pendingSend = true
      return
    }
    val audio = sendTrack ?: sendClip(pcm, sendUsage(context))?.also { sendTrack = it } ?: return
    val played =
      runCatching {
        if (audio.playState == AudioTrack.PLAYSTATE_PLAYING) audio.pause()
        audio.setVolume(1f)
        audio.setPlaybackHeadPosition(0)
        audio.play()
      }.isSuccess
    if (played) return
    runCatching { audio.release() }
    sendTrack = null
    val fresh = sendClip(pcm, sendUsage(context)) ?: return
    sendTrack = fresh
    fresh.setVolume(1f)
    runCatching { fresh.play() }
  }

  private fun ringerSilent(context: Context): Boolean {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
    return am.ringerMode == AudioManager.RINGER_MODE_SILENT
  }

  private fun sendUsage(context: Context): Int {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: return AudioAttributes.USAGE_MEDIA
    val music = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    val notif = am.getStreamVolume(AudioManager.STREAM_NOTIFICATION)
    return if (notif > music) AudioAttributes.USAGE_NOTIFICATION else AudioAttributes.USAGE_MEDIA
  }

  private fun sendClip(pcm: ShortArray, usage: Int): AudioTrack? =
    runCatching {
      val audio =
        AudioTrack.Builder()
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(usage)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
              .build(),
          )
          .setTransferMode(AudioTrack.MODE_STATIC)
          .setBufferSizeInBytes(pcm.size * 2)
          .build()
      audio.write(pcm, 0, pcm.size)
      audio.setVolume(1f)
      audio
    }.getOrNull()

  fun playClaim(context: Context) {
    sendApp = context.applicationContext
    warm()
    val run = Runnable { playClaimNow(sendApp ?: return@Runnable) }
    if (Looper.myLooper() == Looper.getMainLooper()) run.run() else main.post(run)
  }

  private fun playClaimNow(context: Context) {
    if (ringerSilent(context)) return
    val pcm = claimPcm
    if (pcm == null) {
      pendingClaim = true
      return
    }
    val audio = claimTrack ?: sendClip(pcm, sendUsage(context))?.also { claimTrack = it } ?: return
    val played =
      runCatching {
        if (audio.playState == AudioTrack.PLAYSTATE_PLAYING) audio.pause()
        audio.setPlaybackHeadPosition(0)
        audio.play()
      }.isSuccess
    if (played) return
    runCatching { audio.release() }
    claimTrack = null
    val fresh = sendClip(pcm, sendUsage(context)) ?: return
    claimTrack = fresh
    runCatching { fresh.play() }
  }

  fun playReceive(context: Context) {
    warm()
    val app = context.applicationContext
    main.post {
      if (!audible(app)) return@post
      val ready = receiveTrack
      if (ready == null) pendingReceive = true else replay(ready)
    }
  }

  @Volatile private var reactPcm: ShortArray? = null
  @Volatile private var reactTrack: AudioTrack? = null
  private var pendingReact = false

  fun playReact(context: Context) {
    sendApp = context.applicationContext
    warm(context)
    val run = Runnable { playReactNow(sendApp ?: return@Runnable) }
    if (Looper.myLooper() == Looper.getMainLooper()) run.run() else main.post(run)
  }

  private fun playReactNow(context: Context) {
    if (ringerSilent(context)) return
    val pcm = reactPcm
    if (pcm == null) {
      pendingReact = true
      return
    }
    val audio = reactTrack ?: sendClip(pcm, sendUsage(context))?.also { reactTrack = it } ?: return
    val played =
      runCatching {
        if (audio.playState == AudioTrack.PLAYSTATE_PLAYING) audio.pause()
        audio.setVolume(0.55f)
        audio.setPlaybackHeadPosition(0)
        audio.play()
      }.isSuccess
    if (played) return
    runCatching { audio.release() }
    reactTrack = null
    val fresh = sendClip(pcm, sendUsage(context)) ?: return
    reactTrack = fresh
    fresh.setVolume(0.55f)
    runCatching { fresh.play() }
  }

  /** Soft water-drop plink. */
  private fun reactBlip(): ShortArray {
    val n = (RATE * 0.16f).toInt()
    val out = ShortArray(n)
    val attack = 28
    for (i in 0 until n) {
      val t = i / RATE.toDouble()
      val env =
        if (i < attack) i / attack.toDouble()
        else Math.exp(-(i - attack) / (n * 0.18))
      val drip = Math.exp(-t * 38.0)
      val wave =
        0.62 * Math.sin(2.0 * Math.PI * (920.0 - 260.0 * t) * t) * drip +
          0.28 * Math.sin(2.0 * Math.PI * 1480.0 * t) * Math.exp(-t * 55.0) +
          0.12 * Math.sin(2.0 * Math.PI * 2100.0 * t) * Math.exp(-t * 70.0)
      out[i] = (wave * env * 0.28 * 32767.0).toInt().coerceIn(-32767, 32767).toShort()
    }
    return pad(out)
  }

  private fun replay(track: AudioTrack?) {
    val ready = track ?: return
    runCatching {
      ready.pause()
      ready.flush()
      ready.stop()
    }
    runCatching {
      ready.reloadStaticData()
      ready.play()
    }
  }

  private fun audible(context: Context): Boolean {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
    if (am.ringerMode == AudioManager.RINGER_MODE_SILENT) return false
    return am.getStreamVolume(AudioManager.STREAM_MUSIC) > 0
  }

  private fun pad(pcm: ShortArray): ShortArray {
    val minBytes =
      AudioTrack.getMinBufferSize(
        RATE,
        AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    val need = (minBytes / 2).coerceAtLeast(pcm.size)
    if (need <= pcm.size) return pcm
    return ShortArray(need).also { pcm.copyInto(it) }
  }

  private fun track(pcm: ShortArray): AudioTrack? =
    runCatching {
      val audio =
        AudioTrack.Builder()
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
              .build(),
          )
          .setTransferMode(AudioTrack.MODE_STATIC)
          .setBufferSizeInBytes(pcm.size * 2)
          .build()
      audio.write(pcm, 0, pcm.size)
      audio
    }.getOrNull()

  private fun loadWhoosh(context: Context): ShortArray? =
    runCatching {
      context.resources.openRawResource(com.haroldndougou.blyp.R.raw.blyp_shell_send_whoosh).use { input ->
        val bytes = input.readBytes()
        var i = 12
        var dataAt = -1
        var dataLen = 0
        while (i + 8 <= bytes.size) {
          val id = String(bytes, i, 4, Charsets.US_ASCII)
          val len =
            java.nio.ByteBuffer.wrap(bytes, i + 4, 4)
              .order(java.nio.ByteOrder.LITTLE_ENDIAN)
              .int
          if (id == "data") {
            dataAt = i + 8
            dataLen = len
            break
          }
          i += 8 + len + (len and 1)
        }
        if (dataAt < 0 || dataLen < 2) return@use null
        val n = dataLen / 2
        val out = ShortArray(n)
        val buf =
          java.nio.ByteBuffer.wrap(bytes, dataAt, n * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        for (k in 0 until n) out[k] = buf.short
        out
      }
    }.getOrNull()

  private fun whoosh(): ShortArray {
    val n = (RATE * 0.34f).toInt()
    val out = ShortArray(n)
    var noise = 0x2741C3
    var low = 0.0
    var band = 0.0
    for (i in 0 until n) {
      val t = i / n.toDouble()
      val env = Math.sin(Math.PI * Math.pow(t, 0.9)) * Math.pow(1.0 - t, 0.45)
      val cutoff = 0.22 + 0.5 * t
      noise = noise * 1103515245 + 12345
      val white = ((noise ushr 16) and 0xFFFF) / 32768.0 - 1.0
      low += 0.06 * (white - low)
      val air = white - low
      band += cutoff * (air - band)
      out[i] = (band * env * 11000.0).toInt().coerceIn(-32767, 32767).toShort()
    }
    return out
  }

  private fun cheer(): ShortArray {
    val n = (RATE * 0.42f).toInt()
    val out = ShortArray(n)
    bloom(out, 523.0, 0, (RATE * 0.3f).toInt(), 0.5)
    bloom(out, 784.0, (RATE * 0.05f).toInt(), (RATE * 0.34f).toInt(), 0.38)
    bloom(out, 1046.0, (RATE * 0.1f).toInt(), (RATE * 0.24f).toInt(), 0.2)
    return out
  }

  private fun bloom(buf: ShortArray, freq: Double, start: Int, len: Int, gain: Double) {
    val attack = 90
    for (i in 0 until len) {
      val at = start + i
      if (at >= buf.size) return
      val env =
        if (i < attack) i / attack.toDouble()
        else Math.exp(-(i - attack) / (len * 0.55))
      val wave = Math.sin(2.0 * Math.PI * freq * i / RATE)
      val add = (wave * env * gain * 32767.0).toInt()
      buf[at] = (buf[at] + add).coerceIn(-32767, 32767).toShort()
    }
  }

  private fun notes(): ShortArray {
    val n = (RATE * 0.46f).toInt()
    val out = ShortArray(n)
    tone(out, 932.0, 0, (RATE * 0.16f).toInt())
    tone(out, 1244.0, (RATE * 0.09f).toInt(), (RATE * 0.16f).toInt())
    tone(out, 1661.0, (RATE * 0.18f).toInt(), (RATE * 0.20f).toInt())
    return out
  }

  private fun tone(buf: ShortArray, freq: Double, start: Int, len: Int) {
    val attack = 70
    for (i in 0 until len) {
      val at = start + i
      if (at >= buf.size) return
      val env =
        if (i < attack) i / attack.toDouble()
        else Math.exp(-(i - attack) / (len * 0.42))
      val wave = Math.sin(2.0 * Math.PI * freq * i / RATE)
      val add = (wave * env * 0.8 * 32767.0).toInt()
      buf[at] = (buf[at] + add).coerceIn(-32767, 32767).toShort()
    }
  }
}
