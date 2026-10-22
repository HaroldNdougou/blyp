import type { StatusFeedItem, StatusPost } from "@/lib/api/types";

let feed: StatusFeedItem[] = [];
let myUserId = "";
const viewedPostIds = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function getStatusFeedSnapshot(): StatusFeedItem[] {
  return feed;
}

/** Au moins un contact (pas moi) avec un statut actif en cache. */
export function statusFeedHasPeerPosts(): boolean {
  const myId = getStatusMyUserId();
  return feed.some(
    (r) =>
      r.userId !== myId && activePosts(r.posts).length > 0,
  );
}

export function getStatusMyUserId(): string {
  return myUserId;
}

export function isStatusPostViewed(postId: string): boolean {
  return viewedPostIds.has(postId);
}

function phoneKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-9);
}

function rowHasUnseenPosts(row: StatusFeedItem): boolean {
  const live = activePosts(row.posts);
  if (live.length === 0) return false;
  return live.some((p) => !viewedPostIds.has(p.id));
}

function withLocalUnseen(row: StatusFeedItem): StatusFeedItem {
  return { ...row, hasUnseen: rowHasUnseenPosts(row) };
}

function statusFeedRowForPeer(
  peerUserId: string | null | undefined,
  peerPhone: string | null | undefined,
): StatusFeedItem | undefined {
  const uid = String(peerUserId ?? "").trim();
  if (uid) {
    const byId = findStatusFeedItem(uid);
    if (byId) return byId;
  }
  const pk = phoneKey(peerPhone);
  if (!pk) return undefined;
  return feed.find((r) => phoneKey(r.peerPhone) === pk);
}

/** Liste conversations : vert = non vus, gris = vus mais actifs, none = pas de statut. */
export function peerStatusRingVariantForConversation(
  peerUserId: string | null | undefined,
  peerPhone: string | null | undefined,
): "unseen" | "seen" | "none" {
  const row = statusFeedRowForPeer(peerUserId, peerPhone);
  if (!row) return "none";
  const live = activePosts(row.posts);
  if (live.length === 0) return "none";
  return rowHasUnseenPosts(row) ? "unseen" : "seen";
}

/** `userId` pour `/status/view` quand le contact a des statuts actifs. */
export function peerStatusUserIdForConversation(
  peerUserId: string | null | undefined,
  peerPhone: string | null | undefined,
): string | null {
  const row = statusFeedRowForPeer(peerUserId, peerPhone);
  if (!row || activePosts(row.posts).length === 0) return null;
  return row.userId;
}

export function applyStatusFeedSnapshot(
  items: StatusFeedItem[],
  ownerUserId: string,
): void {
  for (const row of items) {
    if (!row.hasUnseen) {
      for (const p of activePosts(row.posts)) {
        viewedPostIds.add(p.id);
      }
    }
  }
  feed = items.map(withLocalUnseen);
  myUserId = ownerUserId;
  notify();
}

export function markStatusPostViewedLocal(postId: string): void {
  const id = String(postId ?? "").trim();
  if (!id || viewedPostIds.has(id)) return;
  viewedPostIds.add(id);
  feed = feed.map((row) => withLocalUnseen(row));
  notify();
}

export function findStatusFeedItem(userId: string): StatusFeedItem | undefined {
  const uid = String(userId ?? "").trim();
  return feed.find((r) => r.userId === uid);
}

export function activePosts(posts: StatusPost[]): StatusPost[] {
  const now = Date.now();
  return posts.filter((p) => {
    const exp = Date.parse(p.expiresAt);
    return Number.isFinite(exp) ? exp > now : true;
  });
}

/** Pastille onglet Actus (statuts contacts non vus). */
export function countUnseenPeerStatuses(): number {
  const myId = getStatusMyUserId();
  return feed.filter(
    (r) =>
      r.userId !== myId &&
      r.hasUnseen &&
      activePosts(r.posts).length > 0,
  ).length;
}

export function subscribeStatusFeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Après publish — anneau à jour sans attendre listStatusFeed. */
export function mergePublishedStatusPost(
  post: StatusPost,
  ownerUserId: string,
): void {
  const uid = String(ownerUserId ?? "").trim();
  if (!uid || !post?.id) return;
  myUserId = uid;
  const rowIdx = feed.findIndex((r) => r.userId === uid);
  if (rowIdx < 0) {
    feed = [
      {
        userId: uid,
        displayName: "",
        peerPhone: null,
        avatarUrl: null,
        posts: [post],
        hasUnseen: false,
      },
      ...feed,
    ];
    notify();
    return;
  }
  const row = feed[rowIdx]!;
  const posts = [...row.posts.filter((p) => p.id !== post.id), post].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  feed = feed.map((r, i) =>
    i === rowIdx ? { ...r, posts, hasUnseen: false } : r,
  );
  notify();
}

export function removeMyStatusPosts(ownerUserId: string): void {
  const uid = String(ownerUserId ?? "").trim();
  feed = feed.map((r) =>
    r.userId === uid ? { ...r, posts: [], hasUnseen: false } : r,
  );
  notify();
}

export function ensureStatusFeedPlaceholder(opts: {
  userId: string;
  displayName: string;
  peerPhone: string | null;
  avatarUrl: string | null;
}): void {
  const uid = String(opts.userId ?? "").trim();
  if (!uid) return;
  myUserId = uid;
  if (feed.some((r) => r.userId === uid)) return;
  feed = [
    {
      userId: uid,
      displayName: opts.displayName,
      peerPhone: opts.peerPhone,
      avatarUrl: opts.avatarUrl,
      posts: [],
      hasUnseen: false,
    },
    ...feed,
  ];
  notify();
}
