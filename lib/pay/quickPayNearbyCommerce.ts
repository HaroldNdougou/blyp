import type { BleTaxiPeer } from "@/lib/ble/types";
import { isOwnNearbyPeer } from "@/lib/peers/isOwnNearbyPeer";
import { getPeerDisplayNameCached } from "@/lib/peers/displayNameCache";

/** Même règle que Pay : premier pair BLE proche, sauf soi-même. */
export function quickPayRecipientFromPeer(
  peer: BleTaxiPeer | null,
  user: Parameters<typeof isOwnNearbyPeer>[1],
): {
  accountId: string;
  name: string;
  phoneDigits: string | null;
} | null {
  if (!peer) return null;
  if (isOwnNearbyPeer(peer, user)) return null;
  const cached = getPeerDisplayNameCached(peer.accountId);
  const name = (cached || peer.displayName || "").trim();
  if (!name) return null;
  return {
    accountId: peer.accountId.trim(),
    name,
    phoneDigits: peer.phoneDigits || null,
  };
}
