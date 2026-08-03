import type { ApiUser } from "@/lib/api/types";
import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  getUserSnapshot,
  hydrateAuthSession,
  setAuthSession,
  subscribeAuthSession,
} from "@/lib/auth/authSession";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

function hydrateTxCache(phone: string) {
  void import("@/lib/transactionsCache").then((m) => {
    void m.hydrateTransactionsCache(phone);
  });
}

async function clearTxCaches() {
  const m = await import("@/lib/transactionsCache");
  m.clearAllTransactionsSnapshots();
}

type AuthContextValue = {
  user: ApiUser | null;
  token: string | null;
  isLoading: boolean;
  requestOtp: (phoneDigits: string) => Promise<{ ok: boolean }>;
  verifyAndSignIn: (phoneDigits: string, code: string) => Promise<ApiUser>;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  updateBalance: (balanceFcfa: number) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  /**
   * Hydratation SecureStore seule pour lever le splash : ne pas attendre `import(api/client)`
   * (gros module en dev → dizaines de secondes possibles avant le 1er écran).
   * `/me` part après, en arrière-plan.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await hydrateAuthSession();
        if (!alive) return;

        const tok = getAccessToken();
        const snap = getUserSnapshot();

        if (!tok) {
          if (alive) setIsLoading(false);
          return;
        }

        setToken(tok);
        if (snap) {
          setUser(snap);
        }
        if (alive) setIsLoading(false);

        /**
         * Après levée splash : hydrate SQLite + /me en fond.
         * Ne jamais voler le 1er frame Pay (InteractionManager + délai court).
         */
        const { InteractionManager } = await import("react-native");
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            if (!alive) return;
            if (snap?.phone) hydrateTxCache(snap.phone);

            void (async () => {
              const api = await import("@/lib/api/client");
              /** Access court + refresh long : renouvelle avant /me si besoin. */
              await api.ensureSessionFresh();
              if (!alive) return;
              const current = getAccessToken();
              if (!current) {
                if (getRefreshToken() == null) {
                  await clearAuthSession();
                  await clearTxCaches();
                  if (alive) {
                    setToken(null);
                    setUser(null);
                  }
                }
                return;
              }
              try {
                const me = await api.getMe(current);
                if (!alive || getAccessToken() !== current) return;
                setToken(current);
                setUser(me);
                await setAuthSession(current, getRefreshToken(), me);
                hydrateTxCache(me.phone);
              } catch (e) {
                const { ApiError } = await import("@/lib/api/errors");
                /** Soft-fail réseau : garder le snapshot local. Purge seulement si session morte. */
                if (
                  e instanceof ApiError &&
                  (e.status === 401 || e.status === 403)
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
          }, 80);
        });
      } catch {
        await clearAuthSession();
        await clearTxCaches();
        if (alive) {
          setToken(null);
          setUser(null);
          setIsLoading(false);
        }
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
    await clearAuthSession();
    await clearTxCaches();
    const { resetAggressiveWarm } = await import("@/lib/perf/aggressiveWarm");
    resetAggressiveWarm();
    setToken(null);
    setUser(null);
  }, []);

  const updateBalance = useCallback((balanceFcfa: number) => {
    setUser((prev) => {
      if (!prev) return null;
      const next = { ...prev, balanceFcfa };
      const a = getAccessToken();
      if (a) void setAuthSession(a, getRefreshToken(), next);
      return next;
    });
  }, []);

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
    ],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return ctx;
}
