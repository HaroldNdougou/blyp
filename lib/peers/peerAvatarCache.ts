const byAccount = new Map<string, string>();

export function getPeerAvatarUrlCached(accountId: string): string | null {
  const id = String(accountId ?? "").trim().toUpperCase();
  if (!id) return null;
  return byAccount.get(id) ?? null;
}

export function rememberPeerAvatarUrl(
  accountId: string,
  avatarUrl: string | null | undefined,
): void {
  const id = String(accountId ?? "").trim().toUpperCase();
  const url = String(avatarUrl ?? "").trim();
  if (!id) return;
  if (!url) {
    byAccount.delete(id);
    return;
  }
  byAccount.set(id, url);
}
