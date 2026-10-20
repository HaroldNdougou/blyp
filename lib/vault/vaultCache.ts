import type { VaultListResponse } from "@/lib/api/types";

const byAccount = new Map<string, VaultListResponse>();

export function getVaultSnapshot(accountId: string): VaultListResponse | null {
  const id = String(accountId ?? "").trim();
  if (!id) return null;
  return byAccount.get(id) ?? null;
}

export function setVaultSnapshot(
  accountId: string,
  snap: VaultListResponse,
): void {
  const id = String(accountId ?? "").trim();
  if (!id) return;
  byAccount.set(id, snap);
}

export function clearVaultSnapshot(accountId: string): void {
  byAccount.delete(String(accountId ?? "").trim());
}
