import type { ChatMessage } from "@/lib/api/types";
import { peekImageCache } from "@/lib/image/cache";
import { cacheImageFile } from "@/lib/image/upload";
import { noteMediaCacheHit } from "@/lib/media/lruDiskCache";
import { resolveRemoteDocumentThumbUri } from "@/lib/document/thumbRemote";
import { ensureVoiceCached } from "@/lib/voice/cache";
import { InteractionManager } from "react-native";

const MAX_MESSAGES = 24;

/**
 * Pré-télécharge vignettes / vocaux / thumbs doc des derniers messages (après paint).
 * Pas de PDF entier — ouverture à la demande.
 */
export function prefetchRecentChatMedia(
  token: string,
  conversationId: string,
  messages: ChatMessage[],
): void {
  const cid = String(conversationId ?? "").trim();
  if (!token || !cid || !messages.length) return;
  InteractionManager.runAfterInteractions(() => {
    void prefetchRecentChatMediaAsync(token, cid, messages);
  });
}

async function prefetchRecentChatMediaAsync(
  token: string,
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  const slice = messages.slice(-MAX_MESSAGES).reverse();
  const api = await import("@/lib/api/client");

  for (const m of slice) {
    if (m.deletedForAll) continue;
    try {
      if (m.type === "image" && m.image?.key) {
        const key = m.image.key;
        const hit = await peekImageCache(key);
        if (hit) {
          noteMediaCacheHit(hit);
        } else {
          const thumbKey = String(m.image.thumbKey ?? "").trim();
          if (thumbKey) {
            const thumbHit = await peekImageCache(thumbKey);
            if (thumbHit) {
              noteMediaCacheHit(thumbHit);
            } else {
              const { url: thumbUrl } = await api.presignImagePlay(
                token,
                conversationId,
                thumbKey,
              );
              if (thumbUrl) await cacheImageFile(thumbKey, thumbUrl);
            }
          }
          const { url } = await api.presignImagePlay(
            token,
            conversationId,
            key,
          );
          if (url) await cacheImageFile(key, url);
        }
      } else if (m.type === "voice" && m.voice?.key) {
        await ensureVoiceCached(token, conversationId, m.voice.key);
      } else if (m.type === "document" && m.document?.thumbKey) {
        await resolveRemoteDocumentThumbUri(
          token,
          conversationId,
          m.document.thumbKey,
        );
      }
    } catch {
      /* best effort — réseau / presign */
    }
  }
}
