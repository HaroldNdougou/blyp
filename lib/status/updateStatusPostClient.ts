import { updateStatusPost } from "@/lib/api/client";
import type { UpdateStatusBody } from "@/lib/api/types";
import {
  markStatusPostBumpedAfterEdit,
  mergePublishedStatusPost,
} from "@/lib/status/statusCache";
import { setPendingEditViewerPostId } from "@/lib/status/statusEditReturn";
import { syncStatusFeedFromNetwork } from "@/lib/status/statusSync";

export async function updateMyStatusPostOnServer(
  token: string,
  ownerUserId: string,
  postId: string,
  body: UpdateStatusBody,
): Promise<void> {
  const uid = String(ownerUserId ?? "").trim();
  const id = String(postId ?? "").trim();
  if (!token || !uid || !id) return;
  const { post } = await updateStatusPost(token, id, body);
  mergePublishedStatusPost(post, uid);
  markStatusPostBumpedAfterEdit(id);
  setPendingEditViewerPostId(id);
  syncStatusFeedFromNetwork(token, { force: true });
}
