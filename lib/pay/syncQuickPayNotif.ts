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
import { ensureQuickPayNotificationPermission } from "@/lib/pay/quickPayNotifPermission";

export const QUICK_PAY_AMOUNTS = [50, 100, 200, 500] as const;

function amountLabel(n: number): string {
  return formatFcfa(n, i18n.language);
}

function notifBody(recipientName: string | null): string {
  if (recipientName) {
    return i18n.t("profile.quickPayNotifBodyTo", { name: recipientName });
  }
  return i18n.t("profile.quickPayNotifBodyEmpty");
}

/** Démarre / arrête la notif selon la pref + met à jour le libellé destinataire. */
export async function syncQuickPayNotif(): Promise<{
  ok: boolean;
  reason?: "NO_NATIVE" | "NO_NOTIF_PERMISSION";
}> {
  if (!isQuickPayNotifNativeAvailable()) {
    return { ok: false, reason: "NO_NATIVE" };
  }
  const enabled = await hydrateQuickPayNotifPref();
  if (!enabled) {
    await stopQuickPayNotifNative();
    return { ok: true };
  }
  const notifOk = await ensureQuickPayNotificationPermission();
  if (!notifOk) {
    return { ok: false, reason: "NO_NOTIF_PERMISSION" };
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
