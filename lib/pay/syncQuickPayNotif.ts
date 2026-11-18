import i18n from "@/lib/i18n";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  getQuickPayNotifCached,
  hydrateQuickPayNotifPref,
} from "@/lib/pay/quickPayNotifPref";
import {
  isQuickPayNotifNativeAvailable,
  startQuickPayNotifNative,
  stopQuickPayNotifNative,
} from "@/lib/pay/quickPayNotifNative";
import {
  ensureQuickPayNotificationPermission,
  hasQuickPayNotificationPermission,
} from "@/lib/pay/quickPayNotifPermission";
import {
  getQuickPayNearbyAvatarUrl,
  getQuickPayNearbyRecipientSnapshot,
} from "@/lib/pay/quickPayNearbyRecipientCache";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import {
  avatarBase64ForQuickPayNotif,
  merchantInitialsFromName,
} from "@/lib/pay/quickPayNotifMerchantAvatar";

export const QUICK_PAY_AMOUNTS = [100, 150, 200, 250, 300, 350, 400, 500] as const;

export type SyncQuickPayNotifOptions = {
  /**
   * `true` = activation Profil (peut demander la permission notif).
   * `false` = boot / login / MAJ destinataire — jamais de popup permission.
   */
  interactive?: boolean;
  /** Override nom commerçant (sinon cache BLE). */
  nearbyName?: string | null;
  recipient?: QuickPayRecipient | null;
};

function amountLabel(n: number): string {
  return formatFcfa(n, i18n.language);
}

function notifSubtitle(recipientName: string | null): string {
  if (recipientName) {
    return i18n.t("profile.quickPayNotifBodyTo", { name: recipientName });
  }
  return i18n.t("profile.quickPayNotifBodyEmpty");
}

/** Démarre / arrête / rafraîchit la notif selon la pref. */
export async function syncQuickPayNotif(
  options?: SyncQuickPayNotifOptions,
): Promise<{
  ok: boolean;
  reason?: "NO_NATIVE" | "NO_NOTIF_PERMISSION" | "NOT_ENABLED";
}> {
  if (!isQuickPayNotifNativeAvailable()) {
    return { ok: false, reason: "NO_NATIVE" };
  }
  const enabled = await hydrateQuickPayNotifPref();
  if (!enabled) {
    await stopQuickPayNotifNative();
    return { ok: true, reason: "NOT_ENABLED" };
  }

  const interactive = Boolean(options?.interactive);
  const notifOk = interactive
    ? await ensureQuickPayNotificationPermission(true)
    : await hasQuickPayNotificationPermission();
  if (!notifOk) {
    if (interactive) {
      return { ok: false, reason: "NO_NOTIF_PERMISSION" };
    }
    return { ok: true };
  }

  const recipient =
    options?.recipient !== undefined
      ? options.recipient
      : getQuickPayNearbyRecipientSnapshot();
  let name: string | null;
  if (options?.nearbyName !== undefined) {
    name = options.nearbyName;
  } else {
    name = recipient?.name?.trim() || null;
    if (!name) {
      const { quickPayLabelFromBleSnapshot } = await import(
        "@/lib/pay/quickPayNearbyCommerce"
      );
      const { getUserSnapshot } = await import("@/lib/auth/authSession");
      name = quickPayLabelFromBleSnapshot(getUserSnapshot());
    }
  }

  const merchantName = name?.trim() ?? "";
  const avatarB64 = merchantName
    ? await avatarBase64ForQuickPayNotif(getQuickPayNearbyAvatarUrl())
    : null;

  await startQuickPayNotifNative({
    title: i18n.t("profile.quickPayNotifTitle"),
    body: merchantName ? "" : notifSubtitle(null),
    merchantName,
    merchantInitial: merchantInitialsFromName(merchantName),
    merchantAvatarBase64: avatarB64,
    l50: amountLabel(50),
    l100: amountLabel(100),
    l200: amountLabel(200),
    l500: amountLabel(500),
  });
  void import("@/lib/pay/syncQuickPayNativeSecrets").then((m) =>
    m.syncQuickPayNativeRuntime({
      recipient: recipient ?? undefined,
    }),
  );
  return { ok: true };
}

export async function stopQuickPayNotifIfNeeded(): Promise<void> {
  if (!getQuickPayNotifCached()) return;
  await stopQuickPayNotifNative();
}
