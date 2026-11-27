package com.haroldndougou.blyp.shell

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Effets posés sur le vocal avant l’envoi. */
object BlypShellVoiceFx {
  fun apply(input: File, effect: String): File {
    if (effect.isBlank() || effect == "none") return input
    return try {
      val decoded = decode(input) ?: return input
      val shaped = shape(decoded.samples, decoded.rate, effect)
      encode(shaped, decoded.rate) ?: input
    } catch (_: Exception) {
      input
    }
  }

  private class Pcm(val samples: ShortArray, val rate: Int)

  private fun decode(file: File): Pcm? {
    val extractor = MediaExtractor()
    extractor.setDataSource(file.absolutePath)
    if (extractor.trackCount <= 0) {
      extractor.release()
      return null
    }
    extractor.selectTrack(0)
    val format = extractor.getTrackFormat(0)
    val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
    val codec = MediaCodec.createDecoderByType(mime)
    codec.configure(format, null, null, 0)
    codec.start()
    val out = ArrayList<Short>(64 * 1024)
    var rate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    while (!outputDone) {
      if (!inputDone) {
        val inIndex = codec.dequeueInputBuffer(10_000)
        if (inIndex >= 0) {
          val buf = codec.getInputBuffer(inIndex) ?: continue
          val size = extractor.readSampleData(buf, 0)
          if (size < 0) {
            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }
      val outIndex = codec.dequeueOutputBuffer(info, 10_000)
      when {
        outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          val f = codec.outputFormat
          if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        }
        outIndex >= 0 -> {
          val buf = codec.getOutputBuffer(outIndex)
          if (buf != null && info.size > 1) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            buf.order(ByteOrder.LITTLE_ENDIAN)
            val n = info.size / 2
            val chunk = ShortArray(n)
            buf.asShortBuffer().get(chunk)
            for (s in chunk) out.add(s)
          }
          codec.releaseOutputBuffer(outIndex, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        }
      }
    }
    codec.stop()
    codec.release()
    extractor.release()
    if (out.isEmpty()) return null
    val samples = ShortArray(out.size)
    for (i in out.indices) samples[i] = out[i]
    return Pcm(samples, rate.coerceAtLeast(8000))
  }

  private fun shape(src: ShortArray, rate: Int, effect: String): ShortArray {
    val pitched =
      when (effect) {
        "high" -> pitch(src, 1.45f)
        "squirrel" -> pitch(src, 1.9f)
        "low" -> pitch(src, 0.72f)
        "cave" -> pitch(src, 0.82f)
        else -> src
      }
    return when (effect) {
      "robot" -> robot(pitched, rate)
      "echo" -> echo(pitched, rate / 6, 0.45f)
      "cave" -> echo(pitched, rate / 3, 0.55f)
      "ghost" -> ghost(pitched, rate)
      "radio" -> radio(pitched)
      "phone" -> phone(pitched)
      else -> pitched
    }
  }

  private fun pitch(src: ShortArray, factor: Float): ShortArray {
    if (src.isEmpty() || factor == 1f) return src
    val n = (src.size / factor).toInt().coerceAtLeast(1)
    val out = ShortArray(n)
    for (i in 0 until n) {
      val pos = i * factor
      val a = pos.toInt().coerceIn(0, src.lastIndex)
      val b = (a + 1).coerceAtMost(src.lastIndex)
      val t = pos - a
      out[i] = ((src[a] * (1f - t) + src[b] * t)).toInt().toShort()
    }
    return out
  }

  private fun robot(src: ShortArray, rate: Int): ShortArray {
    val step = (rate / 70).coerceAtLeast(1)
    val out = ShortArray(src.size)
    for (i in src.indices) {
      val sign = if ((i / step) % 2 == 0) 1 else -1
      out[i] = (src[i] * sign * 0.8f).toInt().coerceIn(-32768, 32767).toShort()
    }
    return out
  }

  private fun echo(src: ShortArray, delay: Int, mix: Float): ShortArray {
    val d = delay.coerceAtLeast(1)
    val out = ShortArray(src.size)
    for (i in src.indices) {
      val prev = if (i >= d) out[i - d] else 0
      val v = src[i] * (1f - mix) + prev * mix
      out[i] = v.toInt().coerceIn(-32768, 32767).toShort()
    }
    return out
  }

  private fun ghost(src: ShortArray, rate: Int): ShortArray {
    val out = ShortArray(src.size)
    for (i in src.indices) {
      val wobble = 0.45f + 0.55f * kotlin.math.abs(kotlin.math.sin(i * 12.0 / rate))
      out[i] = (src[i] * wobble).toInt().toShort()
    }
    return out
  }

  private fun radio(src: ShortArray): ShortArray {
    val out = ShortArray(src.size)
    var slow = 0f
    for (i in src.indices) {
      slow += (src[i] - slow) * 0.08f
      val v = ((src[i] - slow) * 1.8f).toInt().coerceIn(-12000, 12000)
      out[i] = v.toShort()
    }
    return out
  }

  private fun phone(src: ShortArray): ShortArray {
    val crushed = ShortArray(src.size)
    for (i in src.indices) {
      val v = (src[i] / 1800) * 1800
      crushed[i] = v.coerceIn(-14000, 14000).toShort()
    }
    return radio(crushed)
  }

  private fun encode(samples: ShortArray, rate: Int): File? {
    val out = File.createTempFile("blyp-voice-fx", ".m4a")
    val format =
      MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 1).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
    val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var track = -1
    var muxerStarted = false
    val info = MediaCodec.BufferInfo()
    var offset = 0
    var inputDone = false
    while (true) {
      if (!inputDone) {
        val inIndex = codec.dequeueInputBuffer(10_000)
        if (inIndex >= 0) {
          val buf = codec.getInputBuffer(inIndex) ?: continue
          buf.clear()
          val room = buf.capacity() / 2
          val n = (samples.size - offset).coerceAtMost(room)
          if (n <= 0) {
            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            buf.order(ByteOrder.LITTLE_ENDIAN)
            val shorts = buf.asShortBuffer()
            shorts.put(samples, offset, n)
            val pts = offset * 1_000_000L / rate
            codec.queueInputBuffer(inIndex, 0, n * 2, pts, 0)
            offset += n
          }
        }
      }
      val outIndex = codec.dequeueOutputBuffer(info, 10_000)
      if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (!muxerStarted) {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxerStarted = true
        }
      } else if (outIndex >= 0) {
        val buf = codec.getOutputBuffer(outIndex)
        if (buf != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && muxerStarted) {
          buf.position(info.offset)
          buf.limit(info.offset + info.size)
          muxer.writeSampleData(track, buf, info)
        }
        codec.releaseOutputBuffer(outIndex, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
      }
    }
    codec.stop()
    codec.release()
    if (muxerStarted) {
      muxer.stop()
    }
    muxer.release()
    return if (out.length() > 200) out else null
  }
}
