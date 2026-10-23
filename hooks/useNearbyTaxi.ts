import { getAccessToken } from "@/lib/auth/authSession";
import {
  getBlePrepareInFlight,
  isBleAutoPromptDeclined,
  subscribeBleConsent,
} from "@/lib/ble/consent";
import {
  getBleScanStatus,
  getBleTaxiPeerSnapshot,
  isTaxiScanFresh,
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
import { getPeerCategoryCached } from "@/lib/peers/peerCategoryCache";
import {
  resolvePeerCategory,
  resolvePeerDisplayName,
} from "@/lib/peers/resolveDisplayName";
import { normalizeSpendCategory } from "@/lib/pay/spendCategory";
import { setPayScanFocused } from "@/lib/ble/payScanGate";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";

/** Anti-spam tap pastille — assez court pour rester « instantané ». */
const REFRESH_DEBOUNCE_MS = 650;
/** Le chrome « Recherche… » ne doit jamais attendre un refresh BLE coincé. */
const REFRESH_UI_MAX_MS = 1600;

function withCachedName(peer: BleTaxiPeer | null): BleTaxiPeer | null {
  if (!peer) return null;
  const cached = getPeerDisplayNameCached(peer.accountId);
  if (!cached || cached === peer.displayName) return peer;
  return { ...peer, displayName: cached };
}

/**
 * Scan BLE taxi uniquement tant que Pay est au premier plan.
 * Coupé sur Messages / Historique / chat — pas de popup hors Pay.
 */
export function useNearbyTaxi(enabled: boolean) {
  const [payFocused, setPayFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPayFocused(true);
      setPayScanFocused(true);
      return () => {
        setPayFocused(false);
        setPayScanFocused(false);
      };
    }, []),
  );
  const scanOn = enabled && payFocused;
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
  useEffect(
    () =>
      subscribeBleConsent((st) => {
        setStatus(st);
      }),
    [],
  );

  useEffect(() => {
    const canScan = scanOn && !broadcasting;

    if (!canScan) {
      void stopTaxiScan();
      if (broadcasting) {
        setRawPeer(null);
        setStatus("idle");
      }
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
        if (
          isBleBroadcasting() ||
          isBleAutoPromptDeclined() ||
          getBleScanStatus() === "powered_off"
        ) {
          return;
        }
        void startTaxiScan().catch(() => {
          setStatus("unavailable");
        });
      } else if (s === "background") {
        if (isBleAutoPromptDeclined() || getBlePrepareInFlight()) return;
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
  }, [scanOn, broadcasting]);

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

  const [categoryEpoch, setCategoryEpoch] = useState(0);

  /** Catégorie API (ex. soa_car) — le BLE ne l’avait pas ou ancienne pub taxi. */
  useEffect(() => {
    const id = rawPeer?.accountId;
    if (!id || !id.startsWith("BLYP-C-")) return;
    if (getPeerCategoryCached(id)) return;
    const gen = resolveGenRef.current;
    const task = InteractionManager.runAfterInteractions(() => {
      void resolvePeerCategory(id, getAccessToken()).then((cat) => {
        if (!cat || resolveGenRef.current !== gen) return;
        setCategoryEpoch((n) => n + 1);
      });
    });
    return () => task.cancel();
  }, [rawPeer?.accountId]);

  /** Étiquette taxi/boutique hors 1er frame — sert les puces montants. */
  useEffect(() => {
    const peer = rawPeer;
    if (!peer?.category) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void import("@/lib/peers/peerCategoryCache").then((m) => {
        m.rememberPeerCategory(
          peer.accountId,
          peer.category,
          peer.phoneDigits,
        );
      });
      void import("@/lib/pay/quickAmounts").then((m) => {
        m.refreshQuickAmountsIndex();
      });
    });
    return () => task.cancel();
  }, [rawPeer?.accountId, rawPeer?.category, rawPeer?.phoneDigits]);

  const peer = useMemo(() => {
    if (!rawPeer) return null;
    void categoryEpoch;
    const fromCache = normalizeSpendCategory(
      getPeerCategoryCached(rawPeer.accountId),
    );
    const category = fromCache ?? rawPeer.category ?? null;
    const resolved = nameById[rawPeer.accountId];
    const displayName =
      resolved && resolved !== rawPeer.displayName
        ? resolved
        : rawPeer.displayName;
    if (category === rawPeer.category && displayName === rawPeer.displayName) {
      return rawPeer;
    }
    return { ...rawPeer, displayName, category };
  }, [rawPeer, nameById, categoryEpoch]);

  const refresh = useCallback(() => {
    if (!scanOn || broadcasting) return false;
    const now = Date.now();
    if (now - lastRefreshAtRef.current < REFRESH_DEBOUNCE_MS) return false;
    lastRefreshAtRef.current = now;

    const gen = ++refreshGenRef.current;
    setRefreshing(true);
    setStatus("starting");
    const cap = setTimeout(() => {
      if (refreshGenRef.current === gen) setRefreshing(false);
    }, REFRESH_UI_MAX_MS);

    void refreshTaxiScan({ forcePrompt: true })
      .catch(() => {
        if (refreshGenRef.current === gen) setStatus("unavailable");
      })
      .finally(() => {
        clearTimeout(cap);
        if (refreshGenRef.current === gen) setRefreshing(false);
      });
    return true;
  }, [scanOn, broadcasting]);

  /** Retour onglet Pay : snapshot immédiat. Relance seulement si le scan n’est pas déjà frais. */
  const resyncOnFocus = useCallback(() => {
    if (!scanOn || broadcasting) return;
    setRawPeer(withCachedName(getBleTaxiPeerSnapshot()));
    const st = getBleScanStatus();
    if (
      st === "starting" ||
      st === "denied" ||
      st === "powered_off" ||
      isTaxiScanFresh() ||
      isBleAutoPromptDeclined()
    ) {
      return;
    }
    const gen = ++refreshGenRef.current;
    setRefreshing(true);
    setStatus("starting");
    const cap = setTimeout(() => {
      if (refreshGenRef.current === gen) setRefreshing(false);
    }, REFRESH_UI_MAX_MS);
    void refreshTaxiScan()
      .catch(() => {
        if (refreshGenRef.current === gen) setStatus("unavailable");
      })
      .finally(() => {
        clearTimeout(cap);
        if (refreshGenRef.current === gen) setRefreshing(false);
      });
  }, [scanOn, broadcasting]);

  return { peer, status, broadcasting, refreshing, refresh, resyncOnFocus };
}
