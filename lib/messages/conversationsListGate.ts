/** Évite listConversations à chaque focus Messages si déjà sync récent. */
let lastPullAtMs = 0;

const MIN_INTERVAL_MS = 15_000;

export function shouldPullConversationsList(): boolean {
  return Date.now() - lastPullAtMs >= MIN_INTERVAL_MS;
}

export function markConversationsListPulled(): void {
  lastPullAtMs = Date.now();
}
