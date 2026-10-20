import type { ChatMessage, Conversation } from "@/lib/api/types";
import { withNormalizedReplyTo } from "@/lib/messages/replyPreview";
import {
  commitOptimisticVoice,
  getConversationsSnapshot,
  getMessagesSnapshot,
  setConversationsSnapshot,
  setMessagesSnapshot,
  sortConversationsByActivity,
} from "@/lib/messagesCache";
import type { ForwardDraft } from "@/lib/messages/forwardDraft";
import { forwardMessagesClientSide } from "@/lib/messages/forwardClientFallback";
import { notifyIncomingMessage } from "@/lib/messages/live";
import { ApiError } from "@/lib/api/errors";

function newClientId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type ForwardTargetPlan = {
  targetConversationId: string;
  clientIdsBySourceId: Record<string, string>;
  optimistic: ChatMessage[];
};

function previewForMessage(msg: ChatMessage): {
  preview: string;
  type: Conversation["lastMessageType"];
} {
  if (msg.type === "voice") {
    return { preview: "VOICE", type: "voice" };
  }
  if (msg.type === "image") {
    const cap = String(msg.body ?? "").trim();
    return { preview: cap || "📷", type: "image" };
  }
  if (msg.type === "document") {
    const cap = String(msg.body ?? "").trim();
    if (cap) return { preview: cap, type: "document" };
    const name = String(msg.document?.fileName ?? "").trim() || "document";
    return {
      preview: name.length > 72 ? `📄 ${name.slice(0, 69)}…` : `📄 ${name}`,
      type: "document",
    };
  }
  const text = String(msg.body ?? "").trim();
  const preview =
    text.length > 80 ? `${text.slice(0, 77)}…` : text || "…";
  return { preview, type: "text" };
}

function bumpConversationPreview(
  token: string,
  conversationId: string,
  msg: ChatMessage,
): void {
  const { preview, type } = previewForMessage(msg);
  const when = String(msg.createdAt ?? "").trim() || new Date().toISOString();
  const prev = getConversationsSnapshot(token) ?? [];
  const next: Conversation[] = prev.map((c) =>
    c.id === conversationId
      ? {
          ...c,
          lastMessagePreview: preview,
          lastMessageType: type,
          lastMessageAt: when,
          updatedAt: when,
          lastMessageFromSelf: true,
        }
      : c,
  );
  setConversationsSnapshot(token, sortConversationsByActivity(next));
}

function sortThread(items: ChatMessage[]): ChatMessage[] {
  const next = [...items];
  next.sort((a, b) => {
    const c = String(a.createdAt).localeCompare(String(b.createdAt));
    return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
  });
  return next;
}

function appendOptimisticToThreadCache(
  token: string,
  conversationId: string,
  items: ChatMessage[],
): void {
  const prev = getMessagesSnapshot(token, conversationId) ?? [];
  const next = sortThread([
    ...prev,
    ...items.map((m) => withNormalizedReplyTo(m)),
  ]);
  setMessagesSnapshot(token, conversationId, next);
}

function rollbackForwardPending(
  token: string,
  conversationId: string,
  clientIds: string[],
): void {
  const drop = new Set(clientIds.filter(Boolean));
  if (drop.size === 0) return;
  const prev = getMessagesSnapshot(token, conversationId);
  if (!prev?.length) return;
  const next = prev.filter((m) => !drop.has(String(m.clientId ?? "")));
  if (next.length === prev.length) return;
  setMessagesSnapshot(token, conversationId, next);
  notifyIncomingMessage(conversationId, undefined, { silent: true });
}

function buildOptimisticForwardMessage(
  source: ChatMessage,
  targetConversationId: string,
  senderUserId: string,
  clientId: string,
  createdAt: string,
): ChatMessage {
  const base: ChatMessage = {
    id: clientId,
    conversationId: targetConversationId,
    senderUserId,
    type: source.type,
    body: source.body,
    moneyTransfer: null,
    voice: source.voice ? { ...source.voice } : null,
    image: source.image ? { ...source.image } : null,
    document: source.document ? { ...source.document } : null,
    reactions: [],
    replyTo: null,
    createdAt,
    clientId,
    forwarded: true,
  };
  return base;
}

export function planForwardToConversations(
  senderUserId: string,
  draft: ForwardDraft,
  targetConversationIds: string[],
): ForwardTargetPlan[] {
  const ordered = draft.messages;
  const baseMs = Date.now();
  return targetConversationIds.map((targetId, targetIdx) => {
    const clientIdsBySourceId: Record<string, string> = {};
    const optimistic: ChatMessage[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const src = ordered[i]!;
      const clientId = newClientId();
      clientIdsBySourceId[src.id] = clientId;
      const createdAt = new Date(baseMs + targetIdx * 10 + i).toISOString();
      optimistic.push(
        buildOptimisticForwardMessage(
          src,
          targetId,
          senderUserId,
          clientId,
          createdAt,
        ),
      );
    }
    return {
      targetConversationId: targetId,
      clientIdsBySourceId,
      optimistic,
    };
  });
}

async function enrichForwardMediaUris(
  token: string,
  plan: ForwardTargetPlan,
): Promise<void> {
  const patches = new Map<string, ChatMessage>();
  for (const msg of plan.optimistic) {
    if (msg.type === "image" && msg.image) {
      const local = String(msg.image.localUri ?? "").trim();
      const key = String(msg.image.key ?? "").trim();
      if (local || !key) continue;
      const hit = await import("@/lib/image/cache").then((m) =>
        m.peekImageCache(key),
      );
      if (!hit) continue;
      patches.set(msg.clientId!, {
        ...msg,
        image: { ...msg.image, localUri: hit },
      });
    }
    if (msg.type === "voice" && msg.voice) {
      const local = String(msg.voice.localUri ?? "").trim();
      const key = String(msg.voice.key ?? "").trim();
      if (local || !key) continue;
      const hit = await import("@/lib/voice/cache").then((m) =>
        m.peekVoiceCache(key),
      );
      if (!hit) continue;
      patches.set(msg.clientId!, {
        ...msg,
        voice: { ...msg.voice, localUri: hit },
      });
    }
    if (msg.type === "document" && msg.document) {
      const local = String(msg.document.localUri ?? "").trim();
      const key = String(msg.document.key ?? "").trim();
      if (local || !key) continue;
      const hit = await import("@/lib/document/cache").then((m) =>
        m.peekDocumentCache(key),
      );
      if (!hit) continue;
      patches.set(msg.clientId!, {
        ...msg,
        document: { ...msg.document, localUri: hit },
      });
    }
  }
  if (patches.size === 0) return;
  const prev = getMessagesSnapshot(token, plan.targetConversationId) ?? [];
  const next = prev.map((m) => {
    const cid = String(m.clientId ?? "");
    const patch = cid ? patches.get(cid) : undefined;
    return patch ?? m;
  });
  setMessagesSnapshot(token, plan.targetConversationId, next);
  notifyIncomingMessage(plan.targetConversationId, undefined, { silent: true });
}

/** Bulles optimistes (horloge) dans chaque fil cible — immédiat au tap Envoyer. */
export function applyForwardOptimistic(
  token: string,
  plans: ForwardTargetPlan[],
): void {
  for (const plan of plans) {
    appendOptimisticToThreadCache(
      token,
      plan.targetConversationId,
      plan.optimistic,
    );
    const last = plan.optimistic[plan.optimistic.length - 1];
    if (last) bumpConversationPreview(token, plan.targetConversationId, last);
    notifyIncomingMessage(plan.targetConversationId, undefined, { silent: true });
    void enrichForwardMediaUris(token, plan).catch(() => {});
  }
  void import("@/lib/messages/chatSounds").then((m) => m.playChatSound("sent"));
}

/** Réseau : remplace les bulles optimistes par les messages serveur (coches). */
export async function completeForwardPlans(
  token: string,
  draft: ForwardDraft,
  plans: ForwardTargetPlan[],
): Promise<void> {
  const { forwardChatMessages } = await import("@/lib/api/client");
  const sourceConversationId = draft.sourceConversationId;
  const ordered = draft.messages;
  const messageIds = ordered.map((m) => m.id);

  let lastError: unknown = null;
  let anySuccess = false;

  for (const plan of plans) {
    const pendingIds = Object.values(plan.clientIdsBySourceId);
    let messages: ChatMessage[] = [];
    try {
      const res = await forwardChatMessages(
        token,
        plan.targetConversationId,
        sourceConversationId,
        messageIds,
        plan.clientIdsBySourceId,
      );
      messages = res.messages ?? [];
    } catch (e) {
      lastError = e;
    }

    if (!messages.length) {
      try {
        messages = await forwardMessagesClientSide(
          token,
          plan.targetConversationId,
          sourceConversationId,
          ordered,
          plan.clientIdsBySourceId,
        );
      } catch (e) {
        lastError = e;
        messages = [];
      }
    }

    if (!messages.length) {
      rollbackForwardPending(token, plan.targetConversationId, pendingIds);
      continue;
    }
    anySuccess = true;

    for (const msg of messages) {
      const cid = String(msg.clientId ?? "").trim();
      if (cid) {
        commitOptimisticVoice(token, plan.targetConversationId, cid, msg);
      }
    }
    bumpConversationPreview(
      token,
      plan.targetConversationId,
      messages[messages.length - 1]!,
    );
    notifyIncomingMessage(plan.targetConversationId, undefined, { silent: true });
  }

  if (!anySuccess) {
    throw lastError instanceof ApiError
      ? lastError
      : new Error("FORWARD_FAILED");
  }
}

/** @deprecated Utiliser plan + apply + complete pour l’optimiste. */
export async function forwardDraftToConversations(
  token: string,
  senderUserId: string,
  draft: ForwardDraft,
  targetConversationIds: string[],
): Promise<void> {
  const plans = planForwardToConversations(
    senderUserId,
    draft,
    targetConversationIds,
  );
  applyForwardOptimistic(token, plans);
  await completeForwardPlans(token, draft, plans);
}
