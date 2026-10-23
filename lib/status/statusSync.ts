import {
  DEMO_PROFILES_ENABLED,
  demoStatusFeedFallback,
} from "@/lib/dev/demoProfiles";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import {
  applyStatusFeedSnapshot,
  markStatusPostViewedLocal,
  statusFeedHasPeerPosts,
} from "@/lib/status/statusCache";
import { InteractionManager } from "react-native";

let lastSyncAt = 0;
const MIN_SYNC_MS = 45_000;

export function syncStatusFeedFromNetwork(
  token: string,
  opts?: { force?: boolean },
): void {
  const t = String(token ?? "").trim();
  if (!t) return;
  const now = Date.now();
  if (!opts?.force && now - lastSyncAt < MIN_SYNC_MS) return;
  InteractionManager.runAfterInteractions(() => {
    void import("@/lib/api/client")
      .then((api) => api.listStatusFeed(t))
      .then((res) => {
        lastSyncAt = Date.now();
        applyStatusFeedSnapshot(res.items, res.myUserId);
      })
      .catch(() => {
        if (__DEV__ && DEMO_PROFILES_ENABLED && !statusFeedHasPeerPosts()) {
          const myId = accessTokenSubject(t) ?? "";
          const fallback = demoStatusFeedFallback(myId);
          applyStatusFeedSnapshot(fallback.items, fallback.myUserId);
        }
      });
  });
}

/** Peinture immédiate des statuts démo (dev) — ne pas attendre le réseau. */
export function applyDemoStatusFeedNow(
  myUserId: string,
  mine: {
    displayName: string;
    peerPhone: string | null;
    avatarUrl: string | null;
  },
): void {
  if (!DEMO_PROFILES_ENABLED || !myUserId) return;
  if (statusFeedHasPeerPosts()) return;
  const res = demoStatusFeedFallback(myUserId, mine);
  applyStatusFeedSnapshot(res.items, res.myUserId);
}

export function confirmStatusView(token: string, postId: string): void {
  const id = String(postId ?? "").trim();
  if (!id) return;
  markStatusPostViewedLocal(id);
  void import("@/lib/api/client")
    .then((api) => api.recordStatusView(token, id))
    .catch(() => {});
}
