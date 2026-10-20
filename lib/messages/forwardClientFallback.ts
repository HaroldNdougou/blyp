import type { ChatMessage } from "@/lib/api/types";
import { withNormalizedReplyTo } from "@/lib/messages/replyPreview";
import { isReactionSyncMessage } from "@/lib/messages/reactionSync";
import { cacheDocumentFile } from "@/lib/document/cache";
import { uploadDocumentFile } from "@/lib/document/upload";
import { cacheImageFile, uploadImageFile } from "@/lib/image/upload";
import { cacheVoiceFile, uploadVoiceFile } from "@/lib/voice/upload";

function newClientId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function resolveImageLocalUri(
  token: string,
  sourceConversationId: string,
  src: ChatMessage,
): Promise<string | null> {
  const img = src.image;
  if (!img) return null;
  const local = String(img.localUri ?? "").trim();
  if (local) return local;
  const key = String(img.key ?? "").trim();
  if (!key) return null;
  const hit = await import("@/lib/image/cache").then((m) =>
    m.peekImageCache(key),
  );
  if (hit) return hit;
  const api = await import("@/lib/api/client");
  const { url } = await api.presignImagePlay(token, sourceConversationId, key);
  return cacheImageFile(key, url);
}

async function resolveVoiceLocalUri(
  token: string,
  sourceConversationId: string,
  src: ChatMessage,
): Promise<string | null> {
  const voice = src.voice;
  if (!voice) return null;
  const local = String(voice.localUri ?? "").trim();
  if (local) return local;
  const key = String(voice.key ?? "").trim();
  if (!key) return null;
  const hit = await import("@/lib/voice/cache").then((m) =>
    m.peekVoiceCache(key),
  );
  if (hit) return hit;
  const api = await import("@/lib/api/client");
  const { url } = await api.presignVoicePlay(token, sourceConversationId, key);
  return cacheVoiceFile(key, url);
}

async function resolveDocumentLocalUri(
  token: string,
  sourceConversationId: string,
  src: ChatMessage,
): Promise<string | null> {
  const doc = src.document;
  if (!doc) return null;
  const local = String(doc.localUri ?? "").trim();
  if (local) return local;
  const key = String(doc.key ?? "").trim();
  if (!key) return null;
  const hit = await import("@/lib/document/cache").then((m) =>
    m.peekDocumentCache(key),
  );
  if (hit) return hit;
  const api = await import("@/lib/api/client");
  const { url } = await api.presignDocumentDownload(
    token,
    sourceConversationId,
    key,
  );
  return cacheDocumentFile(key, url);
}

/** Repli : renvoie le contenu (pas besoin que l’API `forward` trouve l’id source). */
export async function forwardMessagesClientSide(
  token: string,
  targetConversationId: string,
  sourceConversationId: string,
  ordered: ChatMessage[],
  clientIdsBySourceId: Record<string, string>,
): Promise<ChatMessage[]> {
  const api = await import("@/lib/api/client");
  const out: ChatMessage[] = [];

  for (const src of ordered) {
    const clientId =
      String(clientIdsBySourceId[src.id] ?? "").trim() || newClientId();

    if (src.type === "text") {
      const body = String(src.body ?? "").trim();
      if (!body || isReactionSyncMessage(src)) continue;
      const { message } = await api.sendTextMessage(
        token,
        targetConversationId,
        body,
        clientId,
        null,
        true,
      );
      out.push(withNormalizedReplyTo({ ...message, forwarded: true }));
      continue;
    }

    if (src.type === "image" && src.image) {
      const local = await resolveImageLocalUri(
        token,
        sourceConversationId,
        src,
      );
      if (!local) continue;
      const ct =
        String(src.image.contentType ?? "").trim() || "image/jpeg";
      const presign = await api.presignImageUpload(
        token,
        targetConversationId,
        ct,
      );
      await uploadImageFile(presign.uploadUrl, local, presign.contentType);
      const { message } = await api.sendImageMessage(
        token,
        targetConversationId,
        presign.key,
        src.image.width ?? 0,
        src.image.height ?? 0,
        clientId,
        src.body,
      );
      out.push(withNormalizedReplyTo({ ...message, forwarded: true }));
      continue;
    }

    if (src.type === "voice" && src.voice) {
      const local = await resolveVoiceLocalUri(
        token,
        sourceConversationId,
        src,
      );
      if (!local) continue;
      const presign = await api.presignVoiceUpload(token, targetConversationId);
      await uploadVoiceFile(presign.uploadUrl, local);
      const { message } = await api.sendVoiceMessage(
        token,
        targetConversationId,
        presign.key,
        src.voice.durationMs ?? 0,
        clientId,
      );
      out.push(withNormalizedReplyTo({ ...message, forwarded: true }));
      continue;
    }

    if (src.type === "document" && src.document) {
      const local = await resolveDocumentLocalUri(
        token,
        sourceConversationId,
        src,
      );
      if (!local) continue;
      const doc = src.document;
      const fileName = String(doc.fileName ?? "").trim() || "document";
      const contentType =
        String(doc.contentType ?? "").trim() || "application/octet-stream";
      const presign = await api.presignDocumentUpload(
        token,
        targetConversationId,
        contentType,
        fileName,
      );
      await uploadDocumentFile(presign.uploadUrl, local, presign.contentType);
      let thumbKey: string | null = null;
      const srcThumb = String(doc.thumbKey ?? "").trim();
      if (srcThumb) {
        try {
          const thumbUrl = await api.presignDocumentThumbDownload(
            token,
            sourceConversationId,
            srcThumb,
          );
          const thumbLocal = await cacheImageFile(srcThumb, thumbUrl.url);
          const thumbPresign = await api.presignDocumentThumbUpload(
            token,
            targetConversationId,
          );
          await uploadImageFile(
            thumbPresign.uploadUrl,
            thumbLocal,
            thumbPresign.contentType,
          );
          thumbKey = thumbPresign.key;
        } catch {
          thumbKey = null;
        }
      }
      const { message } = await api.sendDocumentMessage(
        token,
        targetConversationId,
        presign.key,
        fileName,
        doc.sizeBytes ?? 0,
        contentType,
        clientId,
        null,
        thumbKey,
        doc.pageCount ?? null,
        src.body,
      );
      out.push(withNormalizedReplyTo({ ...message, forwarded: true }));
    }
  }

  return out;
}
