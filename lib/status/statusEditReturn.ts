/** Après édition : rouvrir le lecteur sur le statut (nouvelle position). */
let pendingViewerPostId: string | null = null;

export function setPendingEditViewerPostId(postId: string): void {
  pendingViewerPostId = String(postId ?? "").trim() || null;
}

export function consumePendingEditViewerPostId(): string | null {
  const id = pendingViewerPostId;
  pendingViewerPostId = null;
  return id;
}
