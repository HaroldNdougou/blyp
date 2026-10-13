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
  const api = await import("@/lib/api/client");
  const signed = await api.presignImageUpload(
    token,
    job.conversationId,
    job.contentType,
  );
  await uploadImageFile(signed.uploadUrl, job.uri, signed.contentType);
  let localUri = job.uri;
  try {
    localUri = await copyImageIntoCache(signed.key, job.uri);
  } catch {
    /* uri source encore ok */
  }
  const { message } = await api.sendImageMessage(
    token,
    job.conversationId,
    signed.key,
    job.width,
    job.height,
    job.clientId,
    job.caption,
    job.replyToMessageId,
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
        width: job.width,
        height: job.height,
      }),
      localUri,
    },
  };
  const cache = await import("@/lib/messagesCache");
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
