import type { ApiUser } from "@/lib/api/types";
import { notifyIncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  getUserSnapshot,
  hydrateAuthSession,
  setAuthSession,
  subscribeAuthSession,
} from "@/lib/auth/authSession";
import { AuthContext } from "@/contexts/authContextBase";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export { useAuth } from "@/contexts/authContextBase";
export type { AuthContextValue } from "@/contexts/authContextBase";

function hydrateTxCache(phone: string) {
  void import("@/lib/transactionsCache")
    .then((m) => m.hydrateTransactionsCache(phone))
    .catch(() => {
      /* SQLite / race au reload — best effort */
    });
}

async function clearTxCaches() {
  const m = await import("@/lib/transactionsCache");
  m.clearAllTransactionsSnapshots();
}

async function resetTxForPhone(phone: string) {
  const m = await import("@/lib/transactionsCache");
  m.clearTransactionsSnapshot(phone);
}

function buildOptimisticContext(
  prev: ApiUser,
  input: { type: "personal" } | { type: "commerce"; commerceId: string },
): ApiUser {
  if (input.type === "commerce") {
    const c = prev.commerces?.find((x) => x.id === input.commerceId);
    if (!c) return prev;
    return {
      ...prev,
      id: c.accountId,
      firstName: c.name,
      lastName: null,
      balanceFcfa: c.balanceFcfa,
      activeContext: {
        type: "commerce",
        commerceId: c.id,
        name: c.name,
        accountId: c.accountId,
        category: c.category,
      },
      personalFirstName: prev.personalFirstName ?? prev.firstName,
      personalLastName: prev.personalLastName ?? prev.lastName,
      personalAccountId: prev.personalAccountId ?? prev.id,
      personalBalanceFcfa: prev.personalBalanceFcfa ?? prev.balanceFcfa,
    };
  }

  return {
    ...prev,
    id: prev.personalAccountId ?? prev.id,
    firstName: prev.personalFirstName ?? prev.firstName,
    lastName: prev.personalLastName ?? prev.lastName,
    balanceFcfa: prev.personalBalanceFcfa ?? prev.balanceFcfa,
    activeContext: { type: "personal" },
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyUser = useCallback(async (next: ApiUser) => {
    const t = getAccessToken();
    setUser(next);
    if (t) await setAuthSession(t, getRefreshToken(), next);
  }, []);

  const refreshUser = useCallback(async () => {
    const api = await import("@/lib/api/client");
    const t = getAccessToken();
    if (!t) return;
    const me = await api.getMe(t);
    setToken(t);
    setUser(me);
    await setAuthSession(t, getRefreshToken(), me);
  }, []);

  useEffect(() => {
    const unsub = subscribeAuthSession(({ access }) => {
      setToken(access);
      if (!access) setUser(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await hydrateAuthSession();
        if (!alive) return;

        let tok = getAccessToken();
        const refresh = getRefreshToken();
        const snap = getUserSnapshot();

        if (!tok && !refresh) {
          if (alive) setIsLoading(false);
          return;
        }

        if (refresh) {
          const api = await import("@/lib/api/client");
          await api.ensureSessionFresh();
          if (!alive) return;
          tok = getAccessToken();
        }

        if (!tok && !getRefreshToken()) {
          await clearAuthSession();
          await clearTxCaches();
          if (alive) {
            setToken(null);
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        if (alive) {
          setToken(tok);
          if (snap) setUser(snap);
          setIsLoading(false);
        }

        if (snap?.phone) hydrateTxCache(snap.phone);

        const { InteractionManager } = await import("react-native");
        InteractionManager.runAfterInteractions(() => {
          if (!alive) return;
          void (async () => {
            try {
              const current = getAccessToken();
              if (!current) return;
              const api = await import("@/lib/api/client");
              const me = await api.getMe(current);
              if (!alive) return;
              setToken(getAccessToken() ?? current);
              setUser(me);
              await setAuthSession(current, getRefreshToken(), me);
              hydrateTxCache(me.phone);
            } catch (e) {
              const { ApiError } = await import("@/lib/api/errors");
              if (
                e instanceof ApiError &&
                (e.status === 401 || e.status === 403) &&
                !getRefreshToken()
              ) {
                await clearAuthSession();
                await clearTxCaches();
                if (alive) {
                  setToken(null);
                  setUser(null);
                }
              }
            }
          })();
        });
      } catch {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const requestOtp = useCallback(async (phoneDigits: string) => {
    const { requestOtp: ro } = await import("@/lib/api/client");
    return ro(phoneDigits);
  }, []);

  const verifyAndSignIn = useCallback(
    async (phoneDigits: string, code: string) => {
      const api = await import("@/lib/api/client");
      const { token: newToken, refreshToken, user: u } = await api.verifyOtp(
        phoneDigits,
        code,
      );
      await setAuthSession(newToken, refreshToken ?? null, u);
      setToken(newToken);
      setUser(u);
      hydrateTxCache(u.phone);
      return u;
    },
    [],
  );

  const signOut = useCallback(async () => {
    const access = getAccessToken();
    try {
      const { unregisterPushToken, resetPushRegistrationState } = await import(
        "@/lib/push/register"
      );
      await unregisterPushToken(access);
      resetPushRegistrationState();
    } catch {
      /* best effort */
    }
    await clearAuthSession();
    await clearTxCaches();
    const { clearAllMessagesSnapshots } = await import("@/lib/messagesCache");
    clearAllMessagesSnapshots();
    const { resetAggressiveWarm } = await import("@/lib/perf/aggressiveWarm");
    resetAggressiveWarm();
    setToken(null);
    setUser(null);
  }, []);

  const seenPaymentTx = useRef(new Set<string>());

  const applyIncomingPayment = useCallback(
    (data: {
      amountFcfa?: string;
      transactionId?: string;
      contextType?: string;
      commerceId?: string;
    }) => {
      const amount = Math.floor(Number(data.amountFcfa) || 0);
      if (amount <= 0) return;
      const txId = String(data.transactionId ?? "").trim();
      if (txId) {
        if (seenPaymentTx.current.has(txId)) return;
        seenPaymentTx.current.add(txId);
      }
      const commerceId = String(data.commerceId ?? "").trim();
      const isCommerce = data.contextType === "commerce" && commerceId.length > 0;

      setUser((prev) => {
        if (!prev) return null;
        let next: ApiUser;
        if (isCommerce) {
          const commerces = (prev.commerces ?? []).map((c) =>
            c.id === commerceId
              ? { ...c, balanceFcfa: c.balanceFcfa + amount }
              : c,
          );
          const viewing =
            prev.activeContext?.type === "commerce" &&
            prev.activeContext.commerceId === commerceId;
          next = {
            ...prev,
            commerces,
            balanceFcfa: viewing ? prev.balanceFcfa + amount : prev.balanceFcfa,
          };
        } else {
          const viewingPersonal = prev.activeContext?.type !== "commerce";
          next = {
            ...prev,
            balanceFcfa: viewingPersonal
              ? prev.balanceFcfa + amount
              : prev.balanceFcfa,
            personalBalanceFcfa:
              (prev.personalBalanceFcfa ?? prev.balanceFcfa) + amount,
          };
        }
        const a = getAccessToken();
        if (a) void setAuthSession(a, getRefreshToken(), next);
        return next;
      });
      notifyIncomingPaymentFlash({
        amountFcfa: amount,
        transactionId: txId || undefined,
        commerceId: isCommerce ? commerceId : undefined,
        contextType: isCommerce ? "commerce" : "personal",
      });
    },
    [],
  );

  const updateBalance = useCallback((balanceFcfa: number) => {
    setUser((prev) => {
      if (!prev) return null;
      let commerces = prev.commerces;
      if (prev.activeContext?.type === "commerce" && commerces) {
        const cid = prev.activeContext.commerceId;
        commerces = commerces.map((c) =>
          c.id === cid ? { ...c, balanceFcfa } : c,
        );
      }
      const next = { ...prev, balanceFcfa, commerces };
      const a = getAccessToken();
      if (a) void setAuthSession(a, getRefreshToken(), next);
      return next;
    });
  }, []);

  const setActiveContext = useCallback(
    async (
      input: { type: "personal" } | { type: "commerce"; commerceId: string },
    ) => {
      const t = getAccessToken();
      const prev = user;
      if (!t || !prev) throw new Error("Not signed in");

      const optimistic = buildOptimisticContext(prev, input);
      setUser(optimistic);
      void setAuthSession(t, getRefreshToken(), optimistic);
      void resetTxForPhone(prev.phone);

      if (input.type === "personal") {
        void import("@/lib/ble/taxiBroadcastController").then((m) => {
          if (!m.isTaxiBroadcastWanted() && !m.getTaxiBroadcastSnapshot().on) {
            return;
          }
          void m.setTaxiBroadcastEnabled(false, {
            accountId: null,
            phone: null,
          });
        });
      }

      const api = await import("@/lib/api/client");
      const { user: me } = await api.setActiveContext(t, input);
      await applyUser(me);
      void import("@/lib/sync/transactionsSync").then((m) => {
        void m.syncTransactionsFromNetwork(t, me.phone);
      });
      return me;
    },
    [user, applyUser],
  );

  const createCommerce = useCallback(
    async (input: { name: string; category?: string }) => {
      const t = getAccessToken();
      if (!t) throw new Error("Not signed in");
      const api = await import("@/lib/api/client");
      const res = await api.createCommerce(t, input);
      await applyUser(res.user);
      void resetTxForPhone(res.user.phone);
      void import("@/lib/sync/transactionsSync").then((m) => {
        void m.syncTransactionsFromNetwork(t, res.user.phone);
      });
      return res;
    },
    [applyUser],
  );

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      requestOtp,
      verifyAndSignIn,
      refreshUser,
      signOut,
      updateBalance,
      applyIncomingPayment,
      setActiveContext,
      createCommerce,
    }),
    [
      user,
      token,
      isLoading,
      requestOtp,
      verifyAndSignIn,
      refreshUser,
      signOut,
      updateBalance,
      applyIncomingPayment,
      setActiveContext,
      createCommerce,
    ],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
