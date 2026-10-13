/**
 * Vocaux en attente : la bulle reste ; on réessaie jusqu’au réseau.
 * Pas d’alerte, pas de disparition (modèle WhatsApp).
 */
import type { ChatMessage } from "@/lib/api/types";
import {
  copyVoiceIntoCache,
  voiceUriExists,
} from "@/lib/voice/cache";
import { uploadVoiceFile } from "@/lib/voice/upload";

const inflight = new Set<string>();
let flushChain: Promise<void> = Promise.resolve();

type OutboxListener = (conversationId: string, items: ChatMessage[]) => void;
const listeners = new Set<OutboxListener>();

export function subscribeVoiceOutbox(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function kickVoiceOutbox(token: string): void {
  const t = String(token ?? "").trim();
  if (!t) return;
  flushChain = flushChain
    .then(
      () => flushOnce(t),
      () => flushOnce(t),
    )
    .catch(() => {
      /* file conservée — reconnect / foreground */
    });
}

async function flushOnce(token: string): Promise<void> {
  const cache = await import("@/lib/messagesCache");
  const jobs = cache.listOptimisticVoiceOutbox(token);
  if (jobs.length === 0) return;
  for (const job of jobs) {
    if (inflight.has(job.clientId)) continue;
    inflight.add(job.clientId);
    try {
      await sendOne(token, job);
    } catch {
      /* reste en file — prochain kick = reconnect / foreground, pas un poll */
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
    durationMs: number;
    replyToMessageId?: string | null;
  },
): Promise<void> {
  if (!(await voiceUriExists(job.uri))) {
    return;
  }
  const api = await import("@/lib/api/client");
  const signed = await api.presignVoiceUpload(token, job.conversationId);
  await uploadVoiceFile(signed.uploadUrl, job.uri);
  let localUri = job.uri;
  try {
    localUri = await copyVoiceIntoCache(signed.key, job.uri);
  } catch {
    /* uri d’enregistrement encore lisible */
  }
  const { message } = await api.sendVoiceMessage(
    token,
    job.conversationId,
    signed.key,
    job.durationMs,
    job.clientId,
    job.replyToMessageId,
  );
  const merged: ChatMessage = {
    ...message,
    voice: {
      ...(message.voice ?? {
        key: signed.key,
        durationMs: job.durationMs,
      }),
      localUri,
    },
  };
  const cache = await import("@/lib/messagesCache");
  const next = cache.commitOptimisticVoice(
    token,
    job.conversationId,
    job.clientId,
    merged,
  );
  if (next) {
    listeners.forEach((l) => l(job.conversationId, next));
  }
}
