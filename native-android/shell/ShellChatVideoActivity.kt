package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity

/** Lecture d’une vidéo envoyée dans le chat. */
class ShellChatVideoActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val path = intent.getStringExtra(EXTRA_PATH)?.trim().orEmpty()
    if (path.isEmpty()) {
      finish()
      return
    }
    val video = VideoView(this)
    video.setBackgroundColor(Color.BLACK)
    setContentView(video)
    video.setVideoPath(path)
    video.setOnPreparedListener { video.start() }
    video.setOnCompletionListener { video.seekTo(0) }
    video.setOnClickListener { finish() }
  }

  companion object {
    private const val EXTRA_PATH = "path"

    fun start(context: Context, path: String) {
      context.startActivity(Intent(context, ShellChatVideoActivity::class.java).putExtra(EXTRA_PATH, path))
    }
  }
}
