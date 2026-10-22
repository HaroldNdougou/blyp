/**
 * Photos en attente : bulle optimiste jusqu’au réseau (comme les vocaux).
 */
import type { ChatMessage } from "@/lib/api/types";
import { copyImageIntoCache, imageUriExists } from "@/lib/image/cache";
import { uploadImageFile } from "@/lib/image/upload";

const inflight = new Set<string>();
let flushChain: Promise<void> = Promise.resolve();

type OutboxListener = (conversationId: string, items: ChatMessage[]) => void;
const listeners = new Set<OutboxListener>();

export function subscribeImageOutbox(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function kickImageOutbox(token: string): void {
  const t = String(token ?? "").trim();
  if (!t) return;
  flushChain = flushChain
    .then(
      () => flushOnce(t),
      () => flushOnce(t),
    )
    .catch(() => {
      /* file conservée */
    });
}

async function flushOnce(token: string): Promise<void> {
  const cache = await import("@/lib/messagesCache");
  const jobs = cache.listOptimisticImageOutbox(token);
  if (jobs.length === 0) return;
  for (const job of jobs) {
    if (inflight.has(job.clientId)) continue;
    inflight.add(job.clientId);
    try {
      await sendOne(token, job);
    } catch {
      /* retry au prochain kick */
    } finally {
      inflight.delete(job.clientId);
    }
  }
}

async function sendOne(
  token: string,
  job: {
    conversationId: string;
    clientId: string;
    uri: string;
    width: number;
    height: number;
    contentType: string;
    caption: string;
    replyToMessageId?: string | null;
  },
): Promise<void> {
  if (!(await imageUriExists(job.uri))) return;
  const { prepareChatImage } = await import("@/lib/image/prepareChatImage");
  const prepared = await prepareChatImage(job.uri);
  const uploadUri = prepared.uri;
  const width = prepared.width;
  const height = prepared.height;
  const contentType = prepared.contentType;
  const blurhash = prepared.blurhash;

  const cache = await import("@/lib/messagesCache");
  const patched = cache.patchOptimisticImageLocal(
    token,
    job.conversationId,
    job.clientId,
    {
      localUri: uploadUri,
      width,
      height,
      contentType,
      blurhash,
    },
  );
  if (patched) {
    listeners.forEach((l) => l(job.conversationId, patched));
  }

  const api = await import("@/lib/api/client");
  const signed = await api.presignImageUpload(
    token,
    job.conversationId,
    contentType,
  );
  await uploadImageFile(signed.uploadUrl, uploadUri, signed.contentType);
  if (signed.thumbUploadUrl && signed.thumbKey) {
    await uploadImageFile(
      signed.thumbUploadUrl,
      prepared.thumbUri,
      "image/jpeg",
    );
  }
  let localUri = uploadUri;
  try {
    localUri = await copyImageIntoCache(signed.key, uploadUri);
    if (signed.thumbKey) {
      await copyImageIntoCache(signed.thumbKey, prepared.thumbUri);
    }
  } catch {
    /* uri source encore ok */
  }
  const { message } = await api.sendImageMessage(
    token,
    job.conversationId,
    signed.key,
    width,
    height,
    job.clientId,
    job.caption,
    job.replyToMessageId,
    {
      thumbKey: signed.thumbKey,
      blurhash,
    },
  );
  const serverId = String(message.id ?? "").trim();
  const merged: ChatMessage = {
    ...message,
    id:
      serverId && serverId !== job.clientId
        ? serverId
        : `m-img-${job.clientId}`,
    body: message.body ?? (job.caption || null),
    image: {
      ...(message.image ?? {
        key: signed.key,
        width,
        height,
      }),
      localUri,
      contentType,
      thumbKey: signed.thumbKey ?? message.image?.thumbKey ?? null,
      blurhash: blurhash ?? message.image?.blurhash ?? null,
    },
  };
  const next = cache.commitOptimisticImage(
    token,
    job.conversationId,
    job.clientId,
    merged,
  );
  if (next) {
    listeners.forEach((l) => l(job.conversationId, next));
  }
}
