import i18n from "@/lib/i18n";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  getQuickPayNotifCached,
  hydrateQuickPayNotifPref,
} from "@/lib/pay/quickPayNotifPref";
import {
  getQuickPayRecipientCached,
  loadQuickPayRecipient,
} from "@/lib/pay/quickPayRecipient";
import {
  isQuickPayNotifNativeAvailable,
  startQuickPayNotifNative,
  stopQuickPayNotifNative,
} from "@/lib/pay/quickPayNotifNative";
import {
  ensureQuickPayNotificationPermission,
  hasQuickPayNotificationPermission,
} from "@/lib/pay/quickPayNotifPermission";

export const QUICK_PAY_AMOUNTS = [50, 100, 200, 500] as const;

export type SyncQuickPayNotifOptions = {
  /**
   * `true` = activation Profil (peut demander la permission notif).
   * `false` = boot / login / MAJ destinataire — jamais de popup permission.
   */
  interactive?: boolean;
};

function amountLabel(n: number): string {
  return formatFcfa(n, i18n.language);
}

function notifBody(recipientName: string | null): string {
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

  await loadQuickPayRecipient();
  const to = getQuickPayRecipientCached();
  await startQuickPayNotifNative({
    title: i18n.t("profile.quickPayNotifTitle"),
    body: notifBody(to?.name ?? null),
    l50: amountLabel(50),
    l100: amountLabel(100),
    l200: amountLabel(200),
    l500: amountLabel(500),
  });
  void import("@/lib/pay/syncQuickPayNativeSecrets").then((m) =>
    m.syncQuickPayNativeRuntime(),
  );
  return { ok: true };
}

export async function stopQuickPayNotifIfNeeded(): Promise<void> {
  if (!getQuickPayNotifCached()) return;
  await stopQuickPayNotifNative();
}
