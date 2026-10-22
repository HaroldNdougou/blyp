/**
 * Textes en attente : bulle + horloge jusqu’au réseau (modèle WhatsApp).
 */
import type { ChatMessage } from "@/lib/api/types";
import { sendChatTextMessage } from "@/lib/messages/chatSend";

const inflight = new Set<string>();
let flushChain: Promise<void> = Promise.resolve();

type OutboxListener = (conversationId: string, items: ChatMessage[]) => void;
const listeners = new Set<OutboxListener>();

export function subscribeTextOutbox(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function kickTextOutbox(token: string): void {
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
  const jobs = cache.listOptimisticTextOutbox(token);
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
    body: string;
    replyToMessageId?: string | null;
  },
): Promise<void> {
  const { message } = await sendChatTextMessage(
    token,
    job.conversationId,
    job.body,
    job.clientId,
    job.replyToMessageId,
  );
  const cache = await import("@/lib/messagesCache");
  const next = cache.commitOptimisticVoice(
    token,
    job.conversationId,
    job.clientId,
    message,
  );
  if (next) {
    for (const fn of listeners) {
      fn(job.conversationId, next);
    }
  }
}
