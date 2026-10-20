/** Ouvre le fil cible après transfert (scroll bas + coches optimistes). */
let landConversationId: string | null = null;

export function setForwardLandChat(conversationId: string): void {
  landConversationId = String(conversationId ?? "").trim() || null;
}

export function consumeForwardLand(conversationId: string): boolean {
  const id = String(conversationId ?? "").trim();
  if (!id || landConversationId !== id) return false;
  landConversationId = null;
  return true;
}
