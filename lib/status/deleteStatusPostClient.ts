import { deleteStatusPost } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  clearStatusPostDeletedLocal,
  removeMyStatusPost,
} from "@/lib/status/statusCache";
import { syncStatusFeedFromNetwork } from "@/lib/status/statusSync";

/** Supprime un statut (cache optimiste + API). */
export async function deleteMyStatusPostOnServer(
  token: string,
  ownerUserId: string,
  postId: string,
): Promise<void> {
  const id = String(postId ?? "").trim();
  const uid = String(ownerUserId ?? "").trim();
  if (!token || !uid || !id) return;

  removeMyStatusPost(uid, id);

  try {
    await deleteStatusPost(token, id);
    clearStatusPostDeletedLocal(id);
    syncStatusFeedFromNetwork(token, { force: true });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 0)) {
      syncStatusFeedFromNetwork(token, { force: true });
      return;
    }
    clearStatusPostDeletedLocal(id);
    syncStatusFeedFromNetwork(token, { force: true });
    throw e;
  }
}
