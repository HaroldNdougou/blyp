import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";

/** Commerçant BLE actuel (RAM) — alimente la notif avant tap montant. */
let snapshot: QuickPayRecipient | null = null;
let avatarUrl: string | null = null;

export function getQuickPayNearbyRecipientSnapshot(): QuickPayRecipient | null {
  return snapshot;
}

export function getQuickPayNearbyAvatarUrl(): string | null {
  return avatarUrl;
}

export function setQuickPayNearbyRecipient(
  next: QuickPayRecipient | null,
  nextAvatarUrl?: string | null,
): void {
  snapshot = next;
  if (nextAvatarUrl !== undefined) {
    avatarUrl = nextAvatarUrl?.trim() || null;
  }
  if (!next) {
    avatarUrl = null;
    void import("@/lib/pay/quickPayNotifMerchantAvatar").then((m) =>
      m.invalidateQuickPayNotifAvatarCache(),
    );
  }
}
