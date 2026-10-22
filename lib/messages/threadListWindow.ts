/** Fenêtre initiale du fil (FlashList) — charge ~20 messages, puis pages au scroll. */
export const THREAD_LIST_PAGE_SIZE = 20;

export function initialThreadWindowCount(messageCount: number): number {
  const n = Math.max(0, Math.floor(messageCount));
  return Math.min(THREAD_LIST_PAGE_SIZE, n);
}

export function nextThreadWindowCount(
  current: number,
  messageCount: number,
): number {
  const n = Math.max(0, Math.floor(messageCount));
  if (n <= 0) return 0;
  return Math.min(n, current + THREAD_LIST_PAGE_SIZE);
}

export function threadWindowCountForIndex(
  index: number,
  messageCount: number,
): number {
  const n = Math.max(0, Math.floor(messageCount));
  const need = Math.max(0, Math.floor(index)) + 1;
  return Math.min(n, Math.max(THREAD_LIST_PAGE_SIZE, need));
}
