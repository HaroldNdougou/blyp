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

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const apiMod = import("@/lib/api/client");
        await Promise.all([hydrateAuthSession(), apiMod]);
        if (!alive) return;

        const tok = getAccessToken();
        const snap = getUserSnapshot();

        if (!tok) {
          if (alive) setIsLoading(false);
          return;
        }

        setToken(tok);
        if (snap) setUser(snap);

        const waitForMe = !snap;
        if (!waitForMe && alive) setIsLoading(false);

        const api = await apiMod;
        try {
          const me = await api.getMe(tok);
          if (!alive) return;
          setUser(me);
          await setAuthSession(tok, getRefreshToken(), me);
        } catch {
          await clearAuthSession();
          if (alive) {
            setToken(null);
            setUser(null);
          }
        } finally {
          if (alive && waitForMe) setIsLoading(false);
        }
      } catch {
        await clearAuthSession();
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
      return u;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await clearAuthSession();
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
