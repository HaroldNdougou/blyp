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

  fun warm() {
    if (started) return
    synchronized(gate) {
      if (started) return
      started = true
    }
    Thread {
      val clip = pad(whoosh())
      val claimClip = pad(cheer())
      val receivePcm = pad(notes())
      main.post {
        sendPcm = clip
        claimPcm = claimClip
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
      }
    }.start()
  }

  fun playSend(context: Context) {
    sendApp = context.applicationContext
    warm()
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
        audio.setPlaybackHeadPosition(0)
        audio.play()
      }.isSuccess
    if (played) return
    runCatching { audio.release() }
    sendTrack = null
    val fresh = sendClip(pcm, sendUsage(context)) ?: return
    sendTrack = fresh
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

  private fun whoosh(): ShortArray {
    val n = (RATE * 0.18f).toInt()
    val out = ShortArray(n)
    var noise = 0x2741C3
    var low = 0.0
    for (i in 0 until n) {
      val t = i / n.toFloat()
      val env = Math.sin(Math.PI * t)
      val cutoff = 0.12 + t * 0.7
      noise = noise * 1103515245 + 12345
      val white = ((noise ushr 16) and 0xFFFF) / 32768.0 - 1.0
      low += cutoff * (white - low)
      val sweep = Math.sin(2.0 * Math.PI * (480.0 + 2200.0 * t) * i / RATE)
      out[i] =
        ((low * 1.15 + sweep * 0.95) * env * 32767.0).toInt().coerceIn(-32767, 32767).toShort()
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
