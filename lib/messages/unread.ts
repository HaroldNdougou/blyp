type UnreadListener = () => void;

const counts = new Map<string, number>();
const listeners = new Set<UnreadListener>();
const seenIds = new Set<string>();
const SEEN_MAX = 80;

function emit(): void {
  for (const cb of listeners) cb();
}

export function getUnread(conversationId: string): number {
  return counts.get(conversationId) ?? 0;
}

export function getTotalUnread(): number {
  let n = 0;
  for (const v of counts.values()) n += v;
  return n;
}

export function bumpUnread(conversationId: string, messageId?: string): void {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  const mid = String(messageId ?? "").trim();
  if (mid) {
    if (seenIds.has(mid)) return;
    seenIds.add(mid);
    if (seenIds.size > SEEN_MAX) {
      const first = seenIds.values().next().value;
      if (first) seenIds.delete(first);
    }
  }
  counts.set(id, (counts.get(id) ?? 0) + 1);
  emit();
}

export function clearUnread(conversationId: string): void {
  const id = String(conversationId ?? "").trim();
  if (!id || !counts.has(id)) return;
  counts.delete(id);
  emit();
}

export function clearAllUnread(): void {
  if (counts.size === 0) return;
  counts.clear();
  emit();
}

export function subscribeUnread(cb: UnreadListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
