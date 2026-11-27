package com.haroldndougou.blyp.shell

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Build
import java.io.File
import java.nio.ByteBuffer

/** Vocal en morceaux : stop pour écouter, puis reprise collée à la suite. */
object ShellChatVoiceRecorder {
  private var recorder: MediaRecorder? = null
  private var piece: File? = null
  private var pieceStartedAt = 0L
  private val parts = ArrayList<File>()
  private var keptMs = 0

  fun start(context: Context): Boolean {
    cancel(context)
    return beginPiece(context)
  }

  fun resume(context: Context): Boolean = beginPiece(context)

  fun level(): Int =
    try {
      recorder?.maxAmplitude ?: 0
    } catch (_: Exception) {
      0
    }

  /** Arrête le morceau en cours et le garde pour l’écoute. */
  fun pause(context: Context): Pair<File, Int>? {
    closePiece(keepShort = false)
    if (parts.isEmpty()) return null
    val file = mix(context, preview = true) ?: parts.last()
    return file to keptMs.coerceAtLeast(1)
  }

  fun finish(context: Context): Pair<File, Int>? {
    val taken = take() ?: return null
    val file = mixTaken(context, taken.first) ?: return null
    return file to taken.second
  }

  /** Ferme le micro tout de suite. Le collage du fichier se fait après, hors écran. */
  fun take(): Pair<List<File>, Int>? {
    closePiece(keepShort = parts.isNotEmpty())
    if (parts.isEmpty()) return null
    val files = ArrayList(parts)
    val ms = keptMs.coerceAtLeast(1)
    parts.clear()
    keptMs = 0
    return files to ms
  }

  fun mixTaken(context: Context, files: List<File>): File? {
    if (files.isEmpty()) return null
    if (files.size == 1) return files[0]
    val out = File(context.cacheDir, "chat-voice-${System.currentTimeMillis()}.m4a")
    return try {
      if (out.exists()) out.delete()
      mux(files, out)
      files.forEach { if (it != out) it.delete() }
      out
    } catch (_: Exception) {
      out.delete()
      files.firstOrNull()
    }
  }

  fun cancel(context: Context) {
    try {
      recorder?.stop()
    } catch (_: Exception) {
    }
    try {
      recorder?.release()
    } catch (_: Exception) {
    }
    recorder = null
    piece?.delete()
    piece = null
    parts.forEach { it.delete() }
    parts.clear()
    keptMs = 0
    File(context.cacheDir, "chat-voice-preview.m4a").delete()
  }

  private fun beginPiece(context: Context): Boolean {
    val file = File(context.cacheDir, "chat-voice-${System.currentTimeMillis()}.m4a")
    return try {
      val r =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          MediaRecorder(context)
        } else {
          @Suppress("DEPRECATION")
          MediaRecorder()
        }
      val sources =
        intArrayOf(
          MediaRecorder.AudioSource.VOICE_COMMUNICATION,
          MediaRecorder.AudioSource.VOICE_RECOGNITION,
          MediaRecorder.AudioSource.MIC,
        )
      var started = false
      for (source in sources) {
        try {
          r.setAudioSource(source)
          r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
          r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
          r.setAudioChannels(1)
          r.setAudioEncodingBitRate(48_000)
          r.setAudioSamplingRate(16_000)
          r.setOutputFile(file.absolutePath)
          r.prepare()
          r.start()
          started = true
          break
        } catch (_: Exception) {
          try {
            r.reset()
          } catch (_: Exception) {
          }
        }
      }
      if (!started) {
        try {
          r.release()
        } catch (_: Exception) {
        }
        file.delete()
        return false
      }
      recorder = r
      piece = file
      pieceStartedAt = System.currentTimeMillis()
      true
    } catch (_: Exception) {
      file.delete()
      false
    }
  }

  private fun closePiece(keepShort: Boolean) {
    val r = recorder ?: return
    val file = piece
    recorder = null
    piece = null
    val elapsed = (System.currentTimeMillis() - pieceStartedAt).toInt()
    try {
      r.stop()
      r.release()
    } catch (_: Exception) {
      try {
        r.release()
      } catch (_: Exception) {
      }
      file?.delete()
      return
    }
    if (file == null || !file.isFile || file.length() < 200 || (elapsed < 450 && !keepShort)) {
      file?.delete()
      return
    }
    parts.add(file)
    keptMs += elapsed.coerceAtLeast(1)
  }

  private fun mix(context: Context, preview: Boolean): File? {
    if (parts.isEmpty()) return null
    if (parts.size == 1 && !preview) return parts[0]
    val out =
      if (preview) {
        File(context.cacheDir, "chat-voice-preview.m4a")
      } else {
        File(context.cacheDir, "chat-voice-${System.currentTimeMillis()}.m4a")
      }
    return try {
      if (out.exists()) out.delete()
      mux(parts, out)
      if (!preview) parts.forEach { if (it != out) it.delete() }
      out
    } catch (_: Exception) {
      out.delete()
      parts.firstOrNull()
    }
  }

  private fun mux(files: List<File>, out: File) {
      val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      var track = -1
      var offset = 0L
      val buffer = ByteBuffer.allocate(256 * 1024)
      val info = MediaCodec.BufferInfo()
      for (file in files) {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        extractor.selectTrack(0)
        if (track < 0) {
          track = muxer.addTrack(extractor.getTrackFormat(0))
          muxer.start()
        }
        var origin = -1L
        while (true) {
          val size = extractor.readSampleData(buffer, 0)
          if (size < 0) break
          val sample = extractor.sampleTime.coerceAtLeast(0L)
          if (origin < 0L) origin = sample
          info.offset = 0
          info.size = size
          info.presentationTimeUs = (sample - origin) + offset
          info.flags = extractor.sampleFlags
          muxer.writeSampleData(track, buffer, info)
          extractor.advance()
        }
        offset = info.presentationTimeUs + 20_000L
        extractor.release()
      }
      muxer.stop()
      muxer.release()
  }
}
