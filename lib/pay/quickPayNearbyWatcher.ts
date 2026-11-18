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
import { hydrateQuickPayNotifPref } from "@/lib/pay/quickPayNotifPref";
import { setQuickPayBleScanWanted } from "@/lib/pay/quickPayBleScanGate";
import { syncQuickPayNearbyMerchantFromPeer } from "@/lib/pay/quickPayNearbyCommerce";
import { setQuickPayNearbyRecipient } from "@/lib/pay/quickPayNearbyRecipientCache";
import { AppState, type AppStateStatus } from "react-native";

/** Scan BLE → profil commerçant sur la notif avant tap montant. */
export function bindQuickPayNearbyCommerceWatcher(user: ApiUser | null): () => void {
  let cancelled = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let kickTimer: ReturnType<typeof setInterval> | null = null;
  let enabled = false;
  let syncGen = 0;

  const applyPeer = (peer: BleTaxiPeer | null) => {
    if (cancelled || !enabled) return;
    const gen = ++syncGen;
    void syncQuickPayNearbyMerchantFromPeer(peer, user).then(() => {
      if (gen !== syncGen) return;
    });
  };

  const scheduleApply = (peer: BleTaxiPeer | null) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => applyPeer(peer), 280);
  };

  void hydrateQuickPayNotifPref().then((on) => {
    enabled = on;
    if (cancelled || !on) {
      setQuickPayBleScanWanted(false);
      return;
    }
    setQuickPayBleScanWanted(true);
    if (!isBleBroadcasting()) {
      void startTaxiScan().then(() => {
        scheduleApply(getBleTaxiPeerSnapshot());
      });
    } else {
      scheduleApply(null);
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
