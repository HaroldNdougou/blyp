import type { ChatMessage } from "@/lib/api/types";
import { mergeNewerOrPending } from "@/lib/messagesCache";

function sortChron(items: ChatMessage[]): ChatMessage[] {
  return items.slice().sort((a, b) => {
    const c = String(a.createdAt).localeCompare(String(b.createdAt));
    return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
  });
}

/** GET récent (limit) : ne pas effacer l’historique local plus ancien. */
export function mergeRecentThreadPull(
  prev: ChatMessage[] | undefined,
  incoming: ChatMessage[],
): ChatMessage[] {
  const merged = mergeNewerOrPending(prev, incoming);
  if (!prev?.length || !incoming.length) return merged;

  const incomingIds = new Set(incoming.map((m) => m.id));
  let oldestIncoming = incoming[0]?.createdAt ?? "";
  for (const m of incoming) {
    if (m.createdAt && m.createdAt < oldestIncoming) oldestIncoming = m.createdAt;
  }

  const olderKept: ChatMessage[] = [];
  for (const m of prev) {
    if (incomingIds.has(m.id)) continue;
    const pending = Boolean(m.clientId && m.id === m.clientId);
    if (pending) continue;
    if (oldestIncoming && m.createdAt && m.createdAt < oldestIncoming) {
      olderKept.push(m);
    }
  }
  if (olderKept.length === 0) return merged;

  const byId = new Map<string, ChatMessage>();
  for (const m of olderKept) byId.set(m.id, m);
  for (const m of merged) byId.set(m.id, m);
  return sortChron([...byId.values()]);
}

/** Page « before » : messages strictement plus anciens. */
export function mergeOlderThreadPull(
  prev: ChatMessage[] | undefined,
  olderPage: ChatMessage[],
): ChatMessage[] {
  if (!olderPage.length) return prev ?? [];
  if (!prev?.length) return sortChron(olderPage);

  const byId = new Map<string, ChatMessage>();
  for (const m of olderPage) byId.set(m.id, m);
  for (const m of prev) byId.set(m.id, m);
  return sortChron([...byId.values()]);
}
