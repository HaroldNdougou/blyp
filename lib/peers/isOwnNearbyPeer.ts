import { fallbackAccountId } from "@/lib/accountId";

/** Ne pas se payer soi-même (BLE / tel). */
export function isOwnNearbyPeer(
  peer: { accountId: string; phoneDigits: string },
  user: {
    id?: string;
    personalAccountId?: string | null;
    phone?: string | null;
  } | null,
): boolean {
  if (!user) return false;
  const peerId = peer.accountId.trim().toUpperCase();
  const personal = String(user.personalAccountId ?? "")
    .trim()
    .toUpperCase();
  if (personal && peerId === personal) return true;
  if (user.id) {
    const derived = fallbackAccountId(user.id).toUpperCase();
    if (peerId === derived) return true;
  }
  const mine = String(user.phone ?? "")
    .replace(/\D/g, "")
    .slice(-9);
  return mine.length === 9 && peer.phoneDigits === mine;
}
