package com.haroldndougou.blyp.shell

import android.content.Context
import com.haroldndougou.blyp.R
import java.io.File

/** Brouillon composer par fil (texte / note vocale), comme WhatsApp. */
object BlypShellChatDraft {
  private const val PREFS = "blyp_shell_chat_drafts"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun loadText(context: Context, conversationId: String): String {
    val id = conversationId.trim()
    if (id.isEmpty()) return ""
    return prefs(context).getString(textKey(id), "").orEmpty()
  }

  fun saveText(context: Context, conversationId: String, text: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val trimmed = text.trim()
    val edit = prefs(context).edit()
    if (trimmed.isEmpty()) {
      edit.remove(textKey(id))
    } else {
      edit.putString(textKey(id), trimmed)
    }
    edit.apply()
    BlypShellChatDraftPreview.syncList(context, id)
  }

  fun clearText(context: Context, conversationId: String) {
    saveText(context, conversationId, "")
  }

  enum class VoiceKind {
    RECORDING,
    PREVIEW,
  }

  fun loadVoiceKind(context: Context, conversationId: String): VoiceKind? {
    val id = conversationId.trim()
    if (id.isEmpty()) return null
    return when (prefs(context).getString(voiceKey(id), "").orEmpty()) {
      "recording" -> VoiceKind.RECORDING
      "preview" -> VoiceKind.PREVIEW
      else -> null
    }
  }

  fun saveVoiceRecording(context: Context, conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    prefs(context).edit().putString(voiceKey(id), "recording").apply()
    BlypShellChatDraftPreview.syncList(context, id)
  }

  fun saveVoicePreview(context: Context, conversationId: String, file: File?, durationMs: Int) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val edit = prefs(context).edit()
    if (file == null || !file.isFile) {
      edit.remove(voiceKey(id))
      edit.remove(voicePathKey(id))
      edit.remove(voiceMsKey(id))
    } else {
      edit.putString(voiceKey(id), "preview")
      edit.putString(voicePathKey(id), file.absolutePath)
      edit.putInt(voiceMsKey(id), durationMs.coerceAtLeast(0))
    }
    edit.apply()
    BlypShellChatDraftPreview.syncList(context, id)
  }

  fun loadVoicePreviewFile(context: Context, conversationId: String): File? {
    val id = conversationId.trim()
    if (id.isEmpty()) return null
    val path = prefs(context).getString(voicePathKey(id), "").orEmpty()
    if (path.isEmpty()) return null
    val f = File(path)
    return f.takeIf { it.isFile }
  }

  fun loadVoicePreviewMs(context: Context, conversationId: String): Int {
    val id = conversationId.trim()
    if (id.isEmpty()) return 0
    return prefs(context).getInt(voiceMsKey(id), 0).coerceAtLeast(0)
  }

  fun clearVoice(context: Context, conversationId: String) {
    val id = conversationId.trim()
    if (id.isEmpty()) return
    val path = prefs(context).getString(voicePathKey(id), "").orEmpty()
    if (path.isNotEmpty()) {
      try {
        File(path).delete()
      } catch (_: Exception) {
      }
    }
    prefs(context).edit()
      .remove(voiceKey(id))
      .remove(voicePathKey(id))
      .remove(voiceMsKey(id))
      .apply()
    BlypShellChatDraftPreview.syncList(context, id)
  }

  fun clearAll(context: Context, conversationId: String) {
    clearText(context, conversationId)
    clearVoice(context, conversationId)
  }

  fun hasAny(context: Context, conversationId: String): Boolean {
    val id = conversationId.trim()
    if (id.isEmpty()) return false
    if (loadText(context, id).isNotEmpty()) return true
    return loadVoiceKind(context, id) != null
  }

  fun listPreviewLine(context: Context, conversationId: String): String? {
    val id = conversationId.trim()
    if (id.isEmpty()) return null
    val text = loadText(context, id)
    if (text.isNotEmpty()) {
      val draft = context.getString(R.string.blyp_shell_messages_draft_prefix)
      val clip = if (text.length > 48) text.take(45) + "…" else text
      return "$draft $clip"
    }
    val voice = loadVoiceKind(context, id) ?: return null
    val draft = context.getString(R.string.blyp_shell_messages_draft_prefix)
    val label =
      when (voice) {
        VoiceKind.RECORDING ->
          context.getString(R.string.blyp_shell_messages_draft_voice_recording)
        VoiceKind.PREVIEW ->
          context.getString(R.string.blyp_shell_messages_draft_voice)
      }
    return "$draft $label"
  }

  private fun textKey(id: String) = "t_$id"
  private fun voiceKey(id: String) = "v_$id"
  private fun voicePathKey(id: String) = "vp_$id"
  private fun voiceMsKey(id: String) = "vm_$id"
}