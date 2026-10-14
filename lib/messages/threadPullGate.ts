/** Évite un GET /messages à chaque focus si le fil RAM est déjà chaud. */
const lastPullAt = new Map<string, number>();

const MIN_INTERVAL_MS = 12_000;

export function shouldPullThreadMessages(
  conversationId: string,
  hasCachedMessages: boolean,
): boolean {
  const id = String(conversationId ?? "").trim();
  if (!id) return false;
  if (!hasCachedMessages) return true;
  const last = lastPullAt.get(id) ?? 0;
  return Date.now() - last >= MIN_INTERVAL_MS;
}

export function markThreadMessagesPulled(conversationId: string): void {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  lastPullAt.set(id, Date.now());
}
