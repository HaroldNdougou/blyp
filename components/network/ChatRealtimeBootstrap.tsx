import { useAuth } from "@/contexts/authContextBase";
import { DEV_BACKGROUND_BOOT_MS } from "@/lib/perf/devMetroLite";
import { useEffect } from "react";
import { InteractionManager } from "react-native";

/** Une socket messagerie en arrière-plan (app connectée) — pas sur le splash. */
export function ChatRealtimeBootstrap() {
  const { token } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      void import("@/lib/messages/chatRealtimeLink").then((m) => {
        if (cancelled) return;
        m.ensureChatRealtimeLink(token);
      });
    };
    const task = InteractionManager.runAfterInteractions(() => {
      if (DEV_BACKGROUND_BOOT_MS > 0) {
        setTimeout(connect, DEV_BACKGROUND_BOOT_MS);
      } else {
        connect();
      }
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
