import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "@/lib/auth/tokenStorage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as api from "@/lib/api/client";
import type { ApiUser } from "@/lib/api/types";

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
    const t = await getStoredToken();
    if (!t) return;
    const me = await api.getMe(t);
    setToken(t);
    setUser(me);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await getStoredToken();
        if (!t || !alive) {
          if (alive) setIsLoading(false);
          return;
        }
        const me = await api.getMe(t);
        if (!alive) return;
        setToken(t);
        setUser(me);
      } catch {
        await clearStoredToken();
        if (alive) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const requestOtp = useCallback(async (phoneDigits: string) => {
    return api.requestOtp(phoneDigits);
  }, []);

  const verifyAndSignIn = useCallback(async (phoneDigits: string, code: string) => {
    const { token: newToken, user: u } = await api.verifyOtp(phoneDigits, code);
    await setStoredToken(newToken);
    setToken(newToken);
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredToken();
    setToken(null);
    setUser(null);
  }, []);

  const updateBalance = useCallback((balanceFcfa: number) => {
    setUser((prev) => (prev ? { ...prev, balanceFcfa } : null));
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
