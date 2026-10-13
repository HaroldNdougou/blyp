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
    val claimed = PaymentPushParser.parseMoneyClaimed(remoteMessage.data)
    if (claimed != null) {
      if (BuildConfig.DEBUG) {
        Log.d(TAG, "money claimed tx=${claimed["transferId"]}")
      }
      MessagePushPresenter.handleMoneyClaimed(applicationContext, claimed)
      return
    }
    val moneyTray = PaymentPushParser.parseMoneyTray(remoteMessage.data)
    if (moneyTray != null) {
      if (BuildConfig.DEBUG) {
        Log.d(TAG, "money tray ${moneyTray["type"]} tx=${moneyTray["transferId"]}")
      }
      MessagePushPresenter.handleMoneyTray(applicationContext, moneyTray)
      return
    }
    val receipt = PaymentPushParser.parseConversationReceipt(remoteMessage.data)
    if (receipt != null) {
      if (BuildConfig.DEBUG) {
        Log.d(TAG, "receipt ${receipt["kind"]} conv=${receipt["conversationId"]}")
      }
      PaymentAnnounceModule.emitConversationReceipt(receipt)
      return
    }
    val typing = PaymentPushParser.parseConversationTyping(remoteMessage.data)
    if (typing != null) {
      PaymentAnnounceModule.emitConversationTyping(typing)
      return
    }
    val moneyUpdated = PaymentPushParser.parseMoneyUpdated(remoteMessage.data)
    if (moneyUpdated != null) {
      PaymentAnnounceModule.emitMoneyUpdated(moneyUpdated)
      return
    }
    super.onMessageReceived(remoteMessage)
  }

  companion object {
    private const val TAG = "BlypPaymentPush"
  }
}
