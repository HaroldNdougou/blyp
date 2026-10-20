import { ensureMessagesSnapshotFromDb } from "@/lib/messagesCache";
import { perfMarkStart } from "@/lib/perf/marks";
import { InteractionManager } from "react-native";

/**
 * Dès le toucher sur une ligne : charger le chunk fil + SQLite uniquement.
 * Le reste après transition — ne pas saturer le thread au `push`.
 */
export function prefetchChatThreadOnPressIn(opts: {
  conversationId: string;
  phone: string;
  token: string;
}): void {
  const cid = String(opts.conversationId ?? "").trim();
  if (!cid || !opts.token) return;
  perfMarkStart("chat_open");
  void import("@/components/messages/ChatThreadScreen");
  if (opts.phone) {
    void ensureMessagesSnapshotFromDb(opts.phone, opts.token, cid);
  }
  InteractionManager.runAfterInteractions(() => {
    void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
  });
}
