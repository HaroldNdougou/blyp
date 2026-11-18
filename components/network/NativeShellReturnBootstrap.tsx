import { useAuth } from "@/contexts/authContextBase";
import { registerNativeShellReturnRefresh } from "@/lib/nativeShell/shellReturnRefresh";
import { useEffect } from "react";

/** Sync profil JS → coque avant retour depuis dépôt, reçus, KYC, etc. */
export function NativeShellReturnBootstrap() {
  const { refreshUser } = useAuth();

  useEffect(() => {
    registerNativeShellReturnRefresh(refreshUser);
    return () => registerNativeShellReturnRefresh(null);
  }, [refreshUser]);

  return null;
}
