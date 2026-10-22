import { ensureMessagesSnapshotFromDb } from "@/lib/messagesCache";
import { runAfterPaint } from "@/lib/perf/deferAfterPaint";
import { perfChatOpenLap, perfMarkStart } from "@/lib/perf/marks";
import { InteractionManager } from "react-native";

/**
 * Dès le toucher sur une ligne : charger le chunk fil + SQLite uniquement.
 * Le reste après transition — ne pas saturer le thread au `push`.
 */
/** Au `router.push` / `replace` fil — mesure clic réel (pas le délai pressIn → relâche). */
export function markChatOpenOnNavigate(): void {
  perfMarkStart("chat_open");
}

export function prefetchChatThreadOnPressIn(opts: {
  conversationId: string;
  phone: string;
  token: string;
}): void {
  const cid = String(opts.conversationId ?? "").trim();
  if (!cid || !opts.token) return;
  void import("@/components/messages/ChatThreadScreen").then(() => {
    perfChatOpenLap("chunk");
    void import("@/components/messages/ChatThreadScreenBody").then(() => {
      perfChatOpenLap("inner_chunk");
    });
  });
  runAfterPaint(() => {
    if (opts.phone) {
      void ensureMessagesSnapshotFromDb(opts.phone, opts.token, cid).then(() => {
        perfChatOpenLap("sqlite");
      });
    }
  });
  InteractionManager.runAfterInteractions(() => {
    void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
  });
}
