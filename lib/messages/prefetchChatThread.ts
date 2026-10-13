import { ensureMessagesSnapshotFromDb } from "@/lib/messagesCache";
import { perfMarkStart } from "@/lib/perf/marks";

/**
 * Dès le toucher sur une ligne de conversation : module thread + SQLite + perms galerie.
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
  void import("@/lib/image/pickFromLibrary").then((m) =>
    m.warmImageLibraryPermission(),
  );
  void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
}
