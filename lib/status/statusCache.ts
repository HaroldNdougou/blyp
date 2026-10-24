import type { StatusFeedItem, StatusPost } from "@/lib/api/types";
import { sortStatusPostsChronological } from "@/lib/status/statusPostOrder";

let feed: StatusFeedItem[] = [];
let myUserId = "";
const viewedPostIds = new Set<string>();
/** Dernier visionnage local (pour re-voir après modification). */
const viewedPostAtMs = new Map<string, number>();
/** Suppressions locales (optimiste) — filtre les sync réseau. */
const tombstonedStatusPostIds = new Set<string>();
const listeners = new Set<() => void>();

function withoutTombstonedPosts(posts: StatusPost[]): StatusPost[] {
  if (tombstonedStatusPostIds.size === 0) return posts;
  return posts.filter((p) => !tombstonedStatusPostIds.has(p.id));
}

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

function isPostSeenByViewer(post: StatusPost): boolean {
  const id = String(post.id ?? "").trim();
  if (!id || !viewedPostIds.has(id)) return false;
  const editedMs = Date.parse(String(post.editedAt ?? ""));
  if (!Number.isFinite(editedMs)) return true;
  const seenMs = viewedPostAtMs.get(id) ?? 0;
  return seenMs >= editedMs;
}

export function isStatusPostViewed(postId: string): boolean {
  const id = String(postId ?? "").trim();
  if (!id) return false;
  for (const row of feed) {
    const post = row.posts.find((p) => p.id === id);
    if (post) return isPostSeenByViewer(post);
  }
  return viewedPostIds.has(id);
}

/** Statuts actifs, triés pour le lecteur (modif = fin de file). */
export function postsInViewerOrder(posts: StatusPost[]): StatusPost[] {
  const now = Date.now();
  const live = posts.filter((p) => {
    const exp = Date.parse(p.expiresAt);
    return Number.isFinite(exp) ? exp > now : true;
  });
  return sortStatusPostsChronological(live);
}

function phoneKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-9);
}

function rowHasUnseenPosts(row: StatusFeedItem): boolean {
  const live = postsInViewerOrder(row.posts);
  if (live.length === 0) return false;
  return live.some((p) => !isPostSeenByViewer(p));
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
      const seenAt = Date.now();
      for (const p of activePosts(row.posts)) {
        viewedPostIds.add(p.id);
        viewedPostAtMs.set(p.id, seenAt);
      }
    }
  }
  feed = items.map((row) =>
    withLocalUnseen({
      ...row,
      posts: withoutTombstonedPosts(row.posts),
    }),
  );
  myUserId = ownerUserId;
  notify();
}

export function markStatusPostDeletedLocal(postId: string): void {
  const id = String(postId ?? "").trim();
  if (!id) return;
  tombstonedStatusPostIds.add(id);
}

export function clearStatusPostDeletedLocal(postId: string): void {
  tombstonedStatusPostIds.delete(String(postId ?? "").trim());
}

export function markStatusPostViewedLocal(postId: string): void {
  const id = String(postId ?? "").trim();
  if (!id) return;
  viewedPostIds.add(id);
  viewedPostAtMs.set(id, Date.now());
  feed = feed.map((row) => withLocalUnseen(row));
  notify();
}

/** Après modification : le statut redevient « non vu » pour le lecteur. */
export function markStatusPostBumpedAfterEdit(postId: string): void {
  const id = String(postId ?? "").trim();
  if (!id) return;
  viewedPostIds.delete(id);
  viewedPostAtMs.delete(id);
  feed = feed.map((row) => withLocalUnseen(row));
  notify();
}

export function findStatusPostById(postId: string): StatusPost | undefined {
  const id = String(postId ?? "").trim();
  if (!id) return undefined;
  for (const row of feed) {
    const hit = row.posts.find((p) => p.id === id);
    if (hit) return hit;
  }
  return undefined;
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

/** Index du 1er statut non vu pour ce contact (0 si tout vu ou inconnu). */
export function statusViewStartIndex(userId: string): number {
  const row = findStatusFeedItem(userId);
  if (!row) return 0;
  const posts = postsInViewerOrder(row.posts);
  for (let i = 0; i < posts.length; i++) {
    if (!isPostSeenByViewer(posts[i]!)) return i;
  }
  return 0;
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
  if (tombstonedStatusPostIds.has(post.id)) return;
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
  const posts = sortStatusPostsChronological([
    ...row.posts.filter((p) => p.id !== post.id),
    post,
  ]);
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

export function removeMyStatusPost(ownerUserId: string, postId: string): void {
  const uid = String(ownerUserId ?? "").trim();
  const pid = String(postId ?? "").trim();
  if (pid) markStatusPostDeletedLocal(pid);
  feed = feed.map((r) => {
    if (r.userId !== uid) return r;
    const posts = r.posts.filter((p) => p.id !== pid);
    return { ...r, posts, hasUnseen: rowHasUnseenPosts({ ...r, posts }) };
  });
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
