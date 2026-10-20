import { useAuth } from "@/contexts/authContextBase";
import { useEffect } from "react";
import { InteractionManager } from "react-native";

/** Une socket messagerie en arrière-plan (app connectée) — pas sur le splash. */
export function ChatRealtimeBootstrap() {
  const { token } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      void import("@/lib/messages/chatRealtimeLink").then((m) => {
        if (cancelled) return;
        m.ensureChatRealtimeLink(token);
      });
    });
    return () => {
      cancelled = true;
      task.cancel?.();
      void import("@/lib/messages/chatRealtimeLink").then((m) =>
        m.stopChatRealtimeLink(),
      );
    };
  }, [token]);

  return null;
}
