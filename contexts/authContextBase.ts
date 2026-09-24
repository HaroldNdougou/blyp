import type { ApiCommerce, ApiUser } from "@/lib/api/types";
import { createContext, useContext } from "react";

export type AuthContextValue = {
  user: ApiUser | null;
  token: string | null;
  isLoading: boolean;
  requestOtp: (phoneDigits: string) => Promise<{ ok: boolean }>;
  verifyAndSignIn: (phoneDigits: string, code: string) => Promise<ApiUser>;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  updateBalance: (balanceFcfa: number) => void;
  applyIncomingPayment: (data: {
    amountFcfa?: string;
    transactionId?: string;
    contextType?: string;
    commerceId?: string;
  }) => void;
  setActiveContext: (
    input: { type: "personal" } | { type: "commerce"; commerceId: string },
  ) => Promise<ApiUser>;
  createCommerce: (input: {
    name: string;
    category?: string;
  }) => Promise<{ commerce: ApiCommerce; user: ApiUser }>;
};

/**
 * Objet contexte isolé : Fast Refresh de AuthProvider ne le recrée pas
 * (sinon useAuth voit null alors que le Provider est toujours là).
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

/** Fast Refresh : évite le redbox si le Provider n’a pas encore remount. */
const DEV_FALLBACK: AuthContextValue = {
  user: null,
  token: null,
  isLoading: true,
  requestOtp: async () => ({ ok: false }),
  verifyAndSignIn: async () => {
    throw new Error("useAuth doit être utilisé dans AuthProvider");
  },
  refreshUser: async () => {},
  signOut: async () => {},
  updateBalance: () => {},
  applyIncomingPayment: () => {},
  setActiveContext: async () => {
    throw new Error("useAuth doit être utilisé dans AuthProvider");
  },
  createCommerce: async () => {
    throw new Error("useAuth doit être utilisé dans AuthProvider");
  },
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  if (__DEV__) return DEV_FALLBACK;
  throw new Error("useAuth doit être utilisé dans AuthProvider");
}
