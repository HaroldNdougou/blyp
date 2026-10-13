import type { ChatMessage } from "@/lib/api/types";

/** Message sortant encore en file (réseau / outbox) — pas de coche tant que l’id serveur n’est pas là. */
export function isOutboundMessagePending(msg: ChatMessage): boolean {
  const clientId = String(msg.clientId ?? "").trim();
  if (!clientId) return false;
  return String(msg.id ?? "").trim() === clientId;
}
