import {
  getBleTaxiPeerSnapshot,
  kickTaxiScanIfActive,
  startTaxiScan,
  stopTaxiScan,
  subscribeBleTaxiPeer,
} from "@/lib/ble/scan";
import { BLYP_BLE_SCAN_KICK_MS } from "@/lib/ble/constants";
import { isBleBroadcasting } from "@/lib/ble/radioMode";
import type { ApiUser } from "@/lib/api/types";
import type { BleTaxiPeer } from "@/lib/ble/types";
import { getAccessToken } from "@/lib/auth/authSession";
import {
  hydrateQuickPayNotifPref,
} from "@/lib/pay/quickPayNotifPref";
import { setQuickPayBleScanWanted } from "@/lib/pay/quickPayBleScanGate";
import { quickPayRecipientFromPeer } from "@/lib/pay/quickPayNearbyCommerce";
import {
  rememberQuickPayRecipient,
  type QuickPayRecipient,
} from "@/lib/pay/quickPayRecipient";
import { syncQuickPayNativeRuntime } from "@/lib/pay/syncQuickPayNativeSecrets";
import { syncQuickPayNotif } from "@/lib/pay/syncQuickPayNotif";
import { resolvePeerDisplayName } from "@/lib/peers/resolveDisplayName";
import { AppState, type AppStateStatus } from "react-native";

function sameRecipient(
  a: QuickPayRecipient | null,
  b: QuickPayRecipient | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.accountId === b.accountId && a.name === b.name;
}

async function recipientForPeer(
  peer: BleTaxiPeer | null,
  user: ApiUser | null,
): Promise<QuickPayRecipient | null> {
  let next = quickPayRecipientFromPeer(peer, user);
  if (!next?.accountId) return null;
  const resolved = await resolvePeerDisplayName(next.accountId, getAccessToken());
  const name = (resolved || next.name).trim();
  if (!name) return null;
  return { ...next, name };
}

/** Met à jour notif + secrets selon le pair BLE le plus proche (comme Pay). */
export function bindQuickPayNearbyCommerceWatcher(user: ApiUser | null): () => void {
  let cancelled = false;
  let lastApplied: QuickPayRecipient | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let kickTimer: ReturnType<typeof setInterval> | null = null;
  let enabled = false;

  const pushNotif = async (recipient: QuickPayRecipient | null) => {
    await rememberQuickPayRecipient(recipient);
    await syncQuickPayNotif({ interactive: false });
    if (recipient) {
      await syncQuickPayNativeRuntime({
        balanceFcfa: user?.balanceFcfa,
        phone: user?.phone ?? undefined,
      });
    }
  };

  const apply = (peer: BleTaxiPeer | null) => {
    if (cancelled || !enabled) return;
    void (async () => {
      const next = await recipientForPeer(peer, user);
      if (next) {
        if (sameRecipient(lastApplied, next)) return;
        lastApplied = next;
        await pushNotif(next);
        return;
      }
      if (peer === null && lastApplied) return;
      if (lastApplied) return;
      await pushNotif(null);
    })();
  };

  const scheduleApply = (peer: BleTaxiPeer | null) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => apply(peer), 280);
  };

  void hydrateQuickPayNotifPref().then((on) => {
    enabled = on;
    if (cancelled || !on) {
      setQuickPayBleScanWanted(false);
      return;
    }
    setQuickPayBleScanWanted(true);
    scheduleApply(getBleTaxiPeerSnapshot());
    if (!isBleBroadcasting()) {
      void startTaxiScan();
    }
    kickTimer = setInterval(() => {
      if (cancelled || !enabled || isBleBroadcasting()) return;
      kickTaxiScanIfActive();
    }, BLYP_BLE_SCAN_KICK_MS);
  });

  const unsubPeer = subscribeBleTaxiPeer((peer) => {
    scheduleApply(peer);
  });

  const onAppState = (state: AppStateStatus) => {
    if (cancelled || !enabled) return;
    if (state === "active" && !isBleBroadcasting()) {
      void startTaxiScan();
      scheduleApply(getBleTaxiPeerSnapshot());
    }
  };
  const appSub = AppState.addEventListener("change", onAppState);

  return () => {
    cancelled = true;
    enabled = false;
    setQuickPayBleScanWanted(false);
    if (debounce) clearTimeout(debounce);
    if (kickTimer) clearInterval(kickTimer);
    unsubPeer();
    appSub.remove();
    void stopTaxiScan();
  };
}
