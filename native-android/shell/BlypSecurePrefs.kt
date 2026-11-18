package com.haroldndougou.blyp.shell

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.concurrent.ConcurrentHashMap

/** Une seule ouverture Keystore par fichier (création = dizaines de ms sur entrée de gamme). */
object BlypSecurePrefs {
  private val cache = ConcurrentHashMap<String, SharedPreferences>()

  fun get(context: Context, name: String): SharedPreferences {
    cache[name]?.let { return it }
    synchronized(this) {
      cache[name]?.let { return it }
      val app = context.applicationContext
      val prefs =
        EncryptedSharedPreferences.create(
          app,
          name,
          MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
          EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
          EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
      cache[name] = prefs
      return prefs
    }
  }
}
