import {
  isNetworkOffline,
  OFFLINE_BANNER_DELAY_MS,
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
  /** Bannière « hors ligne » (après debounce). */
  isOffline: boolean;
  /** Liaison réseau présente (peut être true avant test Internet). */
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  /** Incrémenté à chaque retour online (sync silencieuse). */
  reconnectGeneration: number;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isInternetReachable, setIsInternetReachable] = useState<
    boolean | null
  >(null);
  const [isOffline, setIsOffline] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);

  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIsOfflineRef = useRef(false);

  useEffect(() => {
    if (!isOffline && prevIsOfflineRef.current) {
      setReconnectGeneration((g) => g + 1);
    }
    prevIsOfflineRef.current = isOffline;
  }, [isOffline]);

  useEffect(() => {
    let alive = true;

    const applyState = (state: NetInfoState) => {
      setIsConnected(state.isConnected);
      setIsInternetReachable(state.isInternetReachable);

      const offlineNow = isNetworkOffline(state);

      if (offlineTimerRef.current != null) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }

      if (offlineNow) {
        offlineTimerRef.current = setTimeout(() => {
          offlineTimerRef.current = null;
          if (alive) setIsOffline(true);
        }, OFFLINE_BANNER_DELAY_MS);
      } else if (alive) {
        setIsOffline(false);
      }
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
      if (offlineTimerRef.current != null) {
        clearTimeout(offlineTimerRef.current);
      }
    };
  }, []);

  const value = useMemo<NetworkContextValue>(
    () => ({
      isOffline,
      isConnected,
      isInternetReachable,
      reconnectGeneration,
    }),
    [isOffline, isConnected, isInternetReachable, reconnectGeneration],
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
