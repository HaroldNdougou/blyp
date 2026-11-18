import { router } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { api, logout } from "../lib/api";
import type { EventRow, Overview } from "../lib/adminTypes";
import { ensurePushRegistered, unregisterPush } from "../lib/notifications";

type AdminDashboardValue = {
  admin: string;
  overview: Overview | null;
  events: EventRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (soft?: boolean, userPull?: boolean) => Promise<void>;
  logoutAdmin: () => Promise<void>;
};

const AdminDashboardContext = createContext<AdminDashboardValue | null>(null);

export function AdminDashboardProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [admin, setAdmin] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (soft = false, userPull = false) => {
    if (userPull) setRefreshing(true);
    else if (!soft) setLoading(true);
    setError(null);
    try {
      const [me, ov, feed] = await Promise.all([
        api<{ admin: string }>("/api/me"),
        api<Overview>("/api/overview"),
        api<{ items: EventRow[] }>("/api/events?limit=40"),
      ]);
      setAdmin(me.admin);
      setOverview(ov);
      setEvents(feed.items || []);
    } catch (e: any) {
      if (e?.status === 401) {
        await logout();
        router.replace("/login");
        return;
      }
      setError(e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const logoutAdmin = useCallback(async () => {
    await unregisterPush();
    await logout();
    router.replace("/login");
  }, []);

  useEffect(() => {
    void refresh();
    ensurePushRegistered().catch(() => {});
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh(true);
    });
    const poll = setInterval(() => void refresh(true), 20_000);
    return () => {
      sub.remove();
      clearInterval(poll);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      admin,
      overview,
      events,
      loading,
      refreshing,
      error,
      refresh,
      logoutAdmin,
    }),
    [admin, overview, events, loading, refreshing, error, refresh, logoutAdmin],
  );

  return <AdminDashboardContext.Provider value={value}>{children}</AdminDashboardContext.Provider>;
}

export function useAdminDashboard(): AdminDashboardValue {
  const ctx = useContext(AdminDashboardContext);
  if (!ctx) throw new Error("useAdminDashboard must be used within AdminDashboardProvider");
  return ctx;
}