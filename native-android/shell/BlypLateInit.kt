package com.haroldndougou.blyp.shell

import android.content.Context

/** Travail lourd sorti du démarrage, lancé seulement après le premier affichage. */
object BlypLateInit {
  fun afterFirstFrame(context: Context) {
    val app = context.applicationContext
    try {
      val firebase = Class.forName("com.google.firebase.FirebaseApp")
      val apps = firebase.getMethod("getApps", Context::class.java).invoke(null, app) as List<*>
      if (apps.isEmpty()) {
        firebase.getMethod("initializeApp", Context::class.java).invoke(null, app)
      }
    } catch (_: Throwable) {
    }
    Thread {
      try {
        Class.forName("com.google.mlkit.common.MlKit")
          .getMethod("initialize", Context::class.java)
          .invoke(null, app)
      } catch (_: Throwable) {
      }
    }.start()
  }
}
