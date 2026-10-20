/**
 * Messages 💰 en attente : bulle + horloge jusqu’au réseau (comme voix / images).
 */
import type { ChatMessage } from "@/lib/api/types";
import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";
import {
  clearMoneyOutboxSecrets,
  readMoneyOutboxSecrets,
  type MoneyOutboxMeta,
} from "@/lib/messages/moneyOutboxSecrets";
import { isRetryableMoneySendError } from "@/lib/messages/moneySendRetry";

const inflight = new Set<string>();
let flushChain: Promise<void> = Promise.resolve();

const MONEY_SEND_TIMEOUT_MS = 55_000;

export type MoneyOutboxListener = (
  conversationId: string,
  items: ChatMessage[],
  meta?: { balanceFcfa: number },
) => void;

const listeners = new Set<MoneyOutboxListener>();

export function subscribeMoneyOutbox(listener: MoneyOutboxListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function kickMoneyOutbox(token: string): void {
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
  const phone = cache.getMessagesCacheOwnerPhone();
  if (phone) {
    await cache.hydrateMessagesCache(phone, token).catch(() => {});
  }
  const jobs = cache.listOptimisticMoneyOutbox(token);
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

async function resolvePinAndMeta(
  job: {
    clientId: string;
    idempotencyKey: string;
    replyToMessageId?: string | null;
    caption?: string | null;
    moneyFruitEmoji?: string | null;
    receiptRequired?: boolean;
  },
): Promise<{ pin: string; meta: MoneyOutboxMeta } | null> {
  const fromStore = await readMoneyOutboxSecrets(job.clientId);
  const pin = fromStore?.pin?.trim();
  if (!pin) return null;
  const idempotencyKey = String(
    fromStore?.meta.idempotencyKey ?? job.idempotencyKey ?? "",
  ).trim();
  if (!idempotencyKey) return null;
  return {
    pin,
    meta: {
      idempotencyKey,
      replyToMessageId:
        fromStore?.meta.replyToMessageId ?? job.replyToMessageId ?? null,
      caption: fromStore?.meta.caption ?? job.caption ?? null,
      moneyFruitEmoji:
        fromStore?.meta.moneyFruitEmoji ?? job.moneyFruitEmoji ?? null,
      receiptRequired:
        fromStore?.meta.receiptRequired ?? job.receiptRequired ?? false,
    },
  };
}

async function sendMoneyWithTimeout(
  token: string,
  job: {
    conversationId: string;
    clientId: string;
    amountFcfa: number;
    idempotencyKey: string;
    replyToMessageId?: string | null;
    caption?: string | null;
    moneyFruitEmoji?: string | null;
    receiptRequired?: boolean;
  },
  pin: string,
) {
  const api = await import("@/lib/api/client");
  const call = api.sendMoneyMessage(
    token,
    job.conversationId,
    job.amountFcfa,
    job.clientId,
    job.idempotencyKey,
    pin,
    job.replyToMessageId,
    job.caption,
    job.moneyFruitEmoji,
    job.receiptRequired,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApiError("Network timeout", 0)),
          MONEY_SEND_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendOne(
  token: string,
  job: {
    conversationId: string;
    clientId: string;
    amountFcfa: number;
    idempotencyKey: string;
    replyToMessageId?: string | null;
    caption?: string | null;
    moneyFruitEmoji?: string | null;
    receiptRequired?: boolean;
  },
): Promise<void> {
  const creds = await resolvePinAndMeta(job);
  if (!creds) return;

  try {
    const { message, balanceFcfa } = await sendMoneyWithTimeout(
      token,
      job,
      creds.pin,
    );
    await clearMoneyOutboxSecrets(job.clientId);
    const merged: ChatMessage = {
      ...message,
      clientId: job.clientId,
      moneyFruitEmoji:
        message.moneyFruitEmoji ??
        job.moneyFruitEmoji ??
        creds.meta.moneyFruitEmoji ??
        null,
      moneySendIdempotencyKey: null,
    };
    const cache = await import("@/lib/messagesCache");
    let next = cache.commitOptimisticVoice(
      token,
      job.conversationId,
      job.clientId,
      merged,
    );
    if (!next) {
      const prev = cache.getMessagesSnapshot(token, job.conversationId) ?? [];
      const mapped = prev.map((x) =>
        x.clientId === job.clientId ? merged : x,
      );
      const hit = prev.some((x) => x.clientId === job.clientId);
      next = hit ? mapped : [...mapped, merged];
      cache.setMessagesSnapshot(token, job.conversationId, next);
    }
    cache.bumpConversationFromMessage(token, merged);
    listeners.forEach((l) => l(job.conversationId, next!, { balanceFcfa }));
  } catch (e) {
    if (isTransactionPinInvalidError(e) || !isRetryableMoneySendError(e)) {
      await clearMoneyOutboxSecrets(job.clientId);
      const cache = await import("@/lib/messagesCache");
      const prev = cache.getMessagesSnapshot(token, job.conversationId);
      if (prev) {
        const next = prev.filter((x) => x.clientId !== job.clientId);
        cache.setMessagesSnapshot(token, job.conversationId, next);
        listeners.forEach((l) => l(job.conversationId, next));
      }
    }
    throw e;
  }
}
