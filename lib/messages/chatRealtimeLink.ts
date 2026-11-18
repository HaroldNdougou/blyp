/**
 * Canal temps réel — délègue au hub binaire unique.
 */
import {
  acquireRealtimeHub,
  releaseRealtimeHub,
  sendRealtimeTyping,
  setRealtimeOpenConversation,
} from "@/lib/realtime/realtimeHub";

export function ensureChatRealtimeLink(token: string | null) {
  if (!token) {
    stopChatRealtimeLink();
    return;
  }
  acquireRealtimeHub("chat", token);
}

export function stopChatRealtimeLink() {
  releaseRealtimeHub("chat");
  setRealtimeOpenConversation(null);
}

export function onActiveConversationChanged(conversationId: string | null) {
  setRealtimeOpenConversation(conversationId);
}

export function sendChatTyping(conversationId: string, on: boolean) {
  sendRealtimeTyping(conversationId, on);
}
