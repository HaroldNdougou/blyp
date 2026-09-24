import { getAccessToken } from "@/lib/auth/authSession";
import {
  getBleTaxiPeerSnapshot,
  refreshTaxiScan,
  startTaxiScan,
  stopTaxiScan,
  subscribeBleScanStatus,
  subscribeBleTaxiPeer,
} from "@/lib/ble/scan";
import {
  isBleBroadcasting,
  subscribeBleBroadcasting,
} from "@/lib/ble/radioMode";
import type { BleScanStatus, BleTaxiPeer } from "@/lib/ble/types";
import { getPeerDisplayNameCached } from "@/lib/peers/displayNameCache";
import { resolvePeerDisplayName } from "@/lib/peers/resolveDisplayName";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";

/** Anti-spam tap pastille — assez court pour rester « instantané ». */
const REFRESH_DEBOUNCE_MS = 650;

function withCachedName(peer: BleTaxiPeer | null): BleTaxiPeer | null {
  if (!peer) return null;
  const cached = getPeerDisplayNameCached(peer.accountId);
  if (!cached || cached === peer.displayName) return peer;
  return { ...peer, displayName: cached };
}

/**
 * Scan BLE taxi tant que l’écran Pay est monté.
 * Coupé automatiquement si ce téléphone diffuse (mode taxi).
 * Nom commerce : cache sync immédiat, réseau après paint (zéro lag captage).
 */
export function useNearbyTaxi(enabled: boolean) {
  const [rawPeer, setRawPeer] = useState<BleTaxiPeer | null>(() =>
    enabled && !isBleBroadcasting()
      ? withCachedName(getBleTaxiPeerSnapshot())
      : null,
  );
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<BleScanStatus>("idle");
  const [broadcasting, setBroadcasting] = useState(isBleBroadcasting);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAtRef = useRef(0);
  const refreshGenRef = useRef(0);
  const resolveGenRef = useRef(0);

  useEffect(() => subscribeBleBroadcasting(setBroadcasting), []);

  useEffect(() => {
    const canScan = enabled && !broadcasting;

    if (!canScan) {
      void stopTaxiScan();
      setRawPeer(null);
      setStatus("idle");
      setRefreshing(false);
      return;
    }

    const unsubPeer = subscribeBleTaxiPeer((p) => {
      setRawPeer(withCachedName(p));
    });
    const unsubStatus = subscribeBleScanStatus(setStatus);
    void startTaxiScan().catch(() => {
      setStatus("unavailable");
    });

    const onAppState = (s: AppStateStatus) => {
      if (s === "active") {
        if (!isBleBroadcasting()) {
          void startTaxiScan().catch(() => {
            setStatus("unavailable");
          });
        }
      } else if (s === "background") {
        void stopTaxiScan();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      unsubPeer();
      unsubStatus();
      sub.remove();
      void stopTaxiScan();
    };
  }, [enabled, broadcasting]);

  /** Résolution nom après captage — jamais sur le chemin critique du 1er frame. */
  useEffect(() => {
    const id = rawPeer?.accountId;
    if (!id) return;

    const cached = getPeerDisplayNameCached(id);
    if (cached) {
      setNameById((prev) => (prev[id] === cached ? prev : { ...prev, [id]: cached }));
    }

    const gen = ++resolveGenRef.current;
    const task = InteractionManager.runAfterInteractions(() => {
      void resolvePeerDisplayName(id, getAccessToken()).then((name) => {
        if (!name || resolveGenRef.current !== gen) return;
        setNameById((prev) =>
          prev[id] === name ? prev : { ...prev, [id]: name },
        );
      });
    });
    return () => task.cancel();
  }, [rawPeer?.accountId]);

  const peer = useMemo(() => {
    if (!rawPeer) return null;
    const resolved = nameById[rawPeer.accountId];
    if (!resolved || resolved === rawPeer.displayName) return rawPeer;
    return { ...rawPeer, displayName: resolved };
  }, [rawPeer, nameById]);

  const refresh = useCallback(() => {
    if (!enabled || broadcasting) return false;
    const now = Date.now();
    if (now - lastRefreshAtRef.current < REFRESH_DEBOUNCE_MS) return false;
    lastRefreshAtRef.current = now;

    const gen = ++refreshGenRef.current;
    setRefreshing(true);
    setStatus("starting");

    void refreshTaxiScan()
      .catch(() => {
        if (refreshGenRef.current === gen) setStatus("unavailable");
      })
      .finally(() => {
        if (refreshGenRef.current === gen) setRefreshing(false);
      });
    return true;
  }, [enabled, broadcasting]);

  /** Retour onglet Pay : resync snapshot + relance scan (scan zombie MIUI après Profil). */
  const resyncOnFocus = useCallback(() => {
    if (!enabled || broadcasting) return;
    setRawPeer(withCachedName(getBleTaxiPeerSnapshot()));
    const gen = ++refreshGenRef.current;
    setRefreshing(true);
    setStatus("starting");
    void refreshTaxiScan()
      .catch(() => {
        if (refreshGenRef.current === gen) setStatus("unavailable");
      })
      .finally(() => {
        if (refreshGenRef.current === gen) setRefreshing(false);
      });
  }, [enabled, broadcasting]);

  return { peer, status, broadcasting, refreshing, refresh, resyncOnFocus };
}
