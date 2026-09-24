package com.haroldndougou.blyp.paymentannounce

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import com.haroldndougou.blyp.BuildConfig
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Paiement reçu : notif native + voix — ne dépend pas d’Expo data-only.
 */
class BlypFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val payment = PaymentPushParser.parsePaymentReceived(remoteMessage.data)
    if (payment != null) {
      if (BuildConfig.DEBUG) {
        Log.d(TAG, "payment push tx=${payment["transactionId"]}")
      }
      PaymentAnnounceController.handleRemoteData(applicationContext, payment)
      PaymentAnnounceModule.emitPaymentReceived(payment)
      return
    }
    val message = PaymentPushParser.parseMessageReceived(remoteMessage.data)
    if (message != null) {
      if (BuildConfig.DEBUG) {
        Log.d(TAG, "message push conv=${message["conversationId"]}")
      }
      MessagePushPresenter.handle(applicationContext, message)
      return
    }
    super.onMessageReceived(remoteMessage)
  }

  companion object {
    private const val TAG = "BlypPaymentPush"
  }
}
