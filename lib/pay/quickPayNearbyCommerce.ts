import type { ApiUser } from "@/lib/api/types";
import type { BleTaxiPeer } from "@/lib/ble/types";
import { getBleTaxiPeerSnapshot } from "@/lib/ble/scan";
import { getAccessToken } from "@/lib/auth/authSession";
import { isOwnNearbyPeer } from "@/lib/peers/isOwnNearbyPeer";
import { getPeerDisplayNameCached } from "@/lib/peers/displayNameCache";
import { resolvePeerAvatarUrl, resolvePeerDisplayName } from "@/lib/peers/resolveDisplayName";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import {
  getQuickPayNearbyRecipientSnapshot,
  setQuickPayNearbyRecipient,
} from "@/lib/pay/quickPayNearbyRecipientCache";

/** Même règle que Pay : premier pair BLE proche, sauf soi-même. */
export function quickPayRecipientFromPeer(
  peer: BleTaxiPeer | null,
  user: Parameters<typeof isOwnNearbyPeer>[1],
): QuickPayRecipient | null {
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

export function quickPayLabelFromBleSnapshot(
  user: ApiUser | null | undefined,
): string | null {
  return getQuickPayNearbyRecipientSnapshot()?.name ?? null;
}

/** Met à jour le cache RAM + notif (nom + photo) dès qu’un pair BLE est visible. */
export async function syncQuickPayNearbyMerchantFromPeer(
  peer: BleTaxiPeer | null,
  user: ApiUser | null,
): Promise<void> {
  const base = quickPayRecipientFromPeer(peer, user);
  if (!base) {
    setQuickPayNearbyRecipient(null, null);
    const { syncQuickPayNotif } = await import("@/lib/pay/syncQuickPayNotif");
    await syncQuickPayNotif({ interactive: false });
    return;
  }
  const token = getAccessToken();
  const resolved = await resolvePeerDisplayName(base.accountId, token);
  const name = (resolved || base.name).trim();
  if (!name) {
    setQuickPayNearbyRecipient(null, null);
    const { syncQuickPayNotif } = await import("@/lib/pay/syncQuickPayNotif");
    await syncQuickPayNotif({ interactive: false });
    return;
  }
  const recipient: QuickPayRecipient = { ...base, name };
  const avUrl = await resolvePeerAvatarUrl(base.accountId, token, base.phoneDigits);
  setQuickPayNearbyRecipient(recipient, avUrl);
  const { syncQuickPayNotif } = await import("@/lib/pay/syncQuickPayNotif");
  await syncQuickPayNotif({ interactive: false, recipient });
  void import("@/lib/pay/syncQuickPayNativeSecrets").then((m) =>
    m.syncQuickPayNativeRuntime({
      balanceFcfa: user?.balanceFcfa,
      phone: user?.phone ?? undefined,
      recipient,
    }),
  );
  void import("@/lib/pay/syncShellPayRuntime").then((m) =>
    m.syncShellPayRuntime(user),
  );
}

/** Au tap montant : commerçant déjà affiché sur la notif (cache BLE). */
export async function resolveQuickPayRecipientForAmountTap(
  user: ApiUser | null | undefined,
): Promise<QuickPayRecipient | null> {
  const cached = getQuickPayNearbyRecipientSnapshot();
  if (cached?.accountId) return cached;
  const snap = getBleTaxiPeerSnapshot();
  if (snap && !isOwnNearbyPeer(snap, user)) {
    await syncQuickPayNearbyMerchantFromPeer(snap, user ?? null);
    return getQuickPayNearbyRecipientSnapshot();
  }
  return null;
}
