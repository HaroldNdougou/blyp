import type { ChatMessage } from "@/lib/api/types";

type SendText = (
  token: string,
  conversationId: string,
  body: string,
  clientId: string,
  replyToMessageId?: string | null,
) => Promise<{ message: ChatMessage }>;

type ListMessages = (
  token: string,
  conversationId: string,
) => Promise<{
  items: ChatMessage[];
  peerLastReadAt?: string | null;
  peerLastDeliveredAt?: string | null;
}>;

let sendTextFn: SendText | null = null;
let listMessagesFn: ListMessages | null = null;
let loadPromise: Promise<void> | null = null;

function ensureLoaded(): Promise<void> {
  if (sendTextFn && listMessagesFn) return Promise.resolve();
  loadPromise ??= import("@/lib/api/client").then((m) => {
    sendTextFn = m.sendTextMessage;
    listMessagesFn = m.listMessages;
  });
  return loadPromise;
}

/** Parse hors chemin critique (ouverture fil / warm Pay). */
export function prefetchChatMessaging(): void {
  void ensureLoaded();
}

export async function sendChatTextMessage(
  token: string,
  conversationId: string,
  body: string,
  clientId: string,
  replyToMessageId?: string | null,
): Promise<{ message: ChatMessage }> {
  await ensureLoaded();
  return sendTextFn!(
    token,
    conversationId,
    body,
    clientId,
    replyToMessageId,
  );
}

export async function listChatMessages(
  token: string,
  conversationId: string,
): Promise<{
  items: ChatMessage[];
  peerLastReadAt?: string | null;
  peerLastDeliveredAt?: string | null;
}> {
  await ensureLoaded();
  return listMessagesFn!(token, conversationId);
}
