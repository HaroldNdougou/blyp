import { router } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { api, logout } from "../lib/api";
import type { EventRow, Overview } from "../lib/adminTypes";
import { moneyLine, ringMoney } from "../lib/moneyAlarm";
import { ensurePushRegistered, unregisterPush } from "../lib/notifications";
import { fetchWithdrawalRequests } from "../lib/withdrawalRequests";

type AdminDashboardValue = {
  admin: string;
  overview: Overview | null;
  events: EventRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  depositPending: number;
  withdrawalPending: number;
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
  const [depositPending, setDepositPending] = useState(0);
  const [withdrawalPending, setWithdrawalPending] = useState(0);
  const seenRequests = useRef<Set<string> | null>(null);
  const seenMoneyEvents = useRef<Set<string> | null>(null);

  const requestIsFresh = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && Date.now() - t < 60_000;
  };

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
      const rows = feed.items || [];
      setEvents(rows);
      const moneyRows = rows.filter((ev) => ev.type === "deposit" || ev.type === "withdrawal");
      if (seenMoneyEvents.current == null) {
        seenMoneyEvents.current = new Set(moneyRows.map((ev) => ev.id));
      } else {
        for (const ev of moneyRows) {
          if (seenMoneyEvents.current.has(ev.id)) continue;
          seenMoneyEvents.current.add(ev.id);
          void ringMoney(ev.title || ev.summary);
        }
      }
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

  const pullRequests = useCallback(async () => {
    try {
      const items = await fetchWithdrawalRequests();
      setDepositPending(items.filter((row) => row.kind === "deposit").length);
      setWithdrawalPending(items.filter((row) => row.kind === "withdrawal").length);
      if (seenRequests.current == null) {
        seenRequests.current = new Set(items.map((row) => row.id));
        for (const row of items) {
          if (row.status !== "pending" || !requestIsFresh(row.at)) continue;
          void ringMoney(moneyLine(row.kind, row.amountFcfa, row.phone));
        }
        return;
      }
      for (const row of items) {
        if (row.status !== "pending") continue;
        if (seenRequests.current.has(row.id)) continue;
        seenRequests.current.add(row.id);
        void ringMoney(moneyLine(row.kind, row.amountFcfa, row.phone));
      }
    } catch {
      /* le compteur reste sur le dernier chiffre connu */
    }
  }, []);

  const logoutAdmin = useCallback(async () => {
    await unregisterPush();
    await logout();
    router.replace("/login");
  }, []);

  useEffect(() => {
    const ringFromPush = (n: Notifications.Notification) => {
      const data = (n.request.content.data ?? {}) as Record<string, unknown>;
      const eventType = String(data.eventType ?? "");
      const money = eventType === "deposit" || eventType === "withdrawal" || data.alarm === "1";
      if (!money) return;
      const title =
        n.request.content.title ||
        (typeof data.title === "string" ? data.title : "") ||
        (typeof data.message === "string" ? data.message : "");
      if (title) void ringMoney(title);
    };
    const recv = Notifications.addNotificationReceivedListener(ringFromPush);
    const tap = Notifications.addNotificationResponseReceivedListener((r) => ringFromPush(r.notification));
    return () => {
      recv.remove();
      tap.remove();
    };
  }, []);

  useEffect(() => {
    void refresh();
    void pullRequests();
    ensurePushRegistered().catch(() => {});
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void refresh(true);
        void pullRequests();
      }
    });
    const poll = setInterval(() => void refresh(true), 20_000);
    const requestsPoll = setInterval(() => void pullRequests(), 2_000);
    return () => {
      sub.remove();
      clearInterval(poll);
      clearInterval(requestsPoll);
    };
  }, [pullRequests, refresh]);

  const value = useMemo(
    () => ({
      admin,
      overview,
      events,
      loading,
      refreshing,
      error,
      depositPending,
      withdrawalPending,
      refresh,
      logoutAdmin,
    }),
    [admin, overview, events, loading, refreshing, error, depositPending, withdrawalPending, refresh, logoutAdmin],
  );

  return <AdminDashboardContext.Provider value={value}>{children}</AdminDashboardContext.Provider>;
}

export function useAdminDashboard(): AdminDashboardValue {
  const ctx = useContext(AdminDashboardContext);
  if (!ctx) throw new Error("useAdminDashboard must be used within AdminDashboardProvider");
  return ctx;
}