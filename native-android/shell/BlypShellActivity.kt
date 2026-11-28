package com.haroldndougou.blyp.shell

import android.content.Context
import androidx.appcompat.app.AppCompatActivity

/** Applique la couleur d’accent choisie dans les réglages. */
open class BlypShellActivity : AppCompatActivity() {
  override fun attachBaseContext(newBase: Context) {
    super.attachBaseContext(BlypShellAccent.wrapContext(newBase))
  }
}
