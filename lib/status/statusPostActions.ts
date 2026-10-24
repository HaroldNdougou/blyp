import type { StatusPost } from "@/lib/api/types";
import { setForwardDraft } from "@/lib/messages/forwardDraft";
import { router } from "expo-router";
import { Share } from "react-native";
import i18n from "@/lib/i18n";

/** Ouvre l’écran Transférer (messages) avec le contenu du statut. */
export function forwardStatusPost(post: StatusPost, senderUserId: string): boolean {
  const now = new Date().toISOString();
  let body = "";
  if (post.kind === "text") {
    body = String(post.text ?? "").trim();
  } else {
    body = String(post.text ?? "").trim();
    if (!body && post.mediaUrl) {
      body = i18n.t("status.forwardImageFallback");
    }
  }
  if (!body) return false;

  setForwardDraft({
    sourceConversationId: "__status__",
    messages: [
      {
        id: `fwd-status-${post.id}`,
        conversationId: "__status__",
        senderUserId,
        type: "text",
        body,
        moneyTransfer: null,
        createdAt: now,
        clientId: null,
        forwarded: true,
      },
    ],
  });
  router.push("/forward");
  return true;
}

/** Partage système (hors app). */
export async function shareStatusPost(post: StatusPost): Promise<void> {
  const text = String(post.text ?? "").trim();
  if (post.kind === "image" && post.mediaUrl) {
    await Share.share({
      message: text ? `${text}\n${post.mediaUrl}` : post.mediaUrl,
      url: post.mediaUrl,
    });
    return;
  }
  if (text) {
    await Share.share({ message: text });
  }
}
