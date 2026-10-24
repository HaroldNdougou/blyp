import type { StatusFeedItem, StatusPost } from "@/lib/api/types";
import { postsInViewerOrder, getStatusFeedSnapshot } from "@/lib/status/statusCache";
import { statusPostSortMs } from "@/lib/status/statusPostOrder";

function latestActivePost(row: StatusFeedItem): StatusPost | null {
  const posts = postsInViewerOrder(row.posts);
  return posts.length > 0 ? posts[posts.length - 1]! : null;
}

/** Contacts avec statuts, du plus récent au plus ancien (non vus d’abord). */
export function buildStatusViewerUserQueue(entryUserId: string): string[] {
  const entry = String(entryUserId ?? "").trim();
  const rows = getStatusFeedSnapshot().filter(
    (r) => postsInViewerOrder(r.posts).length > 0,
  );
  const sorted = [...rows].sort((a, b) => {
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    const ta = latestActivePost(a) ? statusPostSortMs(latestActivePost(a)!) : 0;
    const tb = latestActivePost(b) ? statusPostSortMs(latestActivePost(b)!) : 0;
    return tb - ta;
  });
  const ids = sorted.map((r) => r.userId);
  if (!entry) return ids;
  const start = ids.indexOf(entry);
  if (start < 0) return [entry, ...ids.filter((id) => id !== entry)];
  return [...ids.slice(start), ...ids.slice(0, start)];
}

export function nextStatusViewerUserId(
  entryUserId: string,
  currentUserId: string,
): string | null {
  const queue = buildStatusViewerUserQueue(entryUserId);
  const pos = queue.indexOf(currentUserId);
  if (pos < 0) return queue[0] ?? null;
  return queue[pos + 1] ?? null;
}
