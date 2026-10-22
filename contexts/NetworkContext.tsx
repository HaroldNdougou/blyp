import {
  getNetInfoBannerKind,
  OFFLINE_BANNER_DELAY_MS,
  type NetworkBannerKind,
} from "@/lib/network/state";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type NetworkContextValue = {
  /** Fine bande type WhatsApp (liaison / Internet). */
  bannerKind: NetworkBannerKind | null;
  isOffline: boolean;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  reconnectGeneration: number;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isInternetReachable, setIsInternetReachable] = useState<
    boolean | null
  >(null);
  const [netInfoKind, setNetInfoKind] = useState<
    ReturnType<typeof getNetInfoBannerKind>
  >(null);
  const [bannerKind, setBannerKind] = useState<NetworkBannerKind | null>(null);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);

  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBannerRef = useRef<NetworkBannerKind | null>(null);

  useEffect(() => {
    let alive = true;

    const applyState = (state: NetInfoState) => {
      setIsConnected(state.isConnected);
      setIsInternetReachable(state.isInternetReachable);
      setNetInfoKind(getNetInfoBannerKind(state));
    };

    const unsub = NetInfo.addEventListener((state) => {
      if (alive) applyState(state);
    });

    void NetInfo.fetch().then((state) => {
      if (alive) applyState(state);
    });

    return () => {
      alive = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (bannerTimerRef.current != null) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }

    if (netInfoKind == null) {
      setBannerKind(null);
      return;
    }

    bannerTimerRef.current = setTimeout(() => {
      bannerTimerRef.current = null;
      setBannerKind(netInfoKind);
    }, OFFLINE_BANNER_DELAY_MS);

    return () => {
      if (bannerTimerRef.current != null) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, [netInfoKind]);

  useEffect(() => {
    const prev = prevBannerRef.current;
    if (prev != null && bannerKind == null) {
      setReconnectGeneration((g) => g + 1);
    }
    prevBannerRef.current = bannerKind;
  }, [bannerKind]);

  const isOffline = bannerKind != null;

  const value = useMemo<NetworkContextValue>(
    () => ({
      bannerKind,
      isOffline,
      isConnected,
      isInternetReachable,
      reconnectGeneration,
    }),
    [bannerKind, isOffline, isConnected, isInternetReachable, reconnectGeneration],
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetwork must be used within NetworkProvider");
  }
  return ctx;
}
