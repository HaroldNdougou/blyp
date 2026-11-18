package com.haroldndougou.blyp.shell

import android.content.Context

/** Profil coque → écrans natifs (+ îlot RN si besoin caméra KYC / ajout reçu). */
object ProfileShellHandoff {
  fun openReceipts(context: Context) {
    ShellReceiptsActivity.start(context)
  }

  fun openDocuments(context: Context) {
    ShellDocumentsActivity.start(context)
  }

  fun openKyc(context: Context) {
    ShellKycActivity.start(context)
  }

  fun openProfileSettings(context: Context) {
    ShellProfileSettingsActivity.start(context)
  }
}
