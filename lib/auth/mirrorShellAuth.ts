import { API_BASE_URL, ASSETS_CDN_URL, REALTIME_WS_URL } from "@/lib/config";
import { formatRegistrationFullName } from "@/lib/profile/parseRegistrationFullName";
import type { ApiUser } from "@/lib/api/types";
import {
  getAccessToken,
  getUserSnapshot,
} from "@/lib/auth/authSession";
import { Platform } from "react-native";

/** Écrit la session sur disque côté coque (cold start sans React). */
export function mirrorShellAuthToNativeDisk(
  accessToken: string | null,
  user: ApiUser | null | undefined,
): void {
  if (Platform.OS !== "android") return;
  const token = String(accessToken ?? "").trim();
  const signedIn = token.length > 0;
  const p = String(user?.phone ?? "").trim();
  const displayName = user ? formatRegistrationFullName(user) : "";
  const balanceFcfa = Math.floor(Number(user?.balanceFcfa) || 0);
  const avatarUrl = user?.avatarUrl ?? "";
  const isCommerceMode = user?.activeContext?.type === "commerce";
  const kycStatus = String(user?.kycStatus ?? "none");
  const needsOnboarding = Boolean(user?.needsOnboarding);
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | {
          persistAuthMirror?: (
            phone: string,
            accountId: string,
            signedIn: boolean,
            displayName: string,
            balanceFcfa: number,
            avatarUrl: string,
            apiBaseUrl: string,
            accessToken: string,
            assetsCdnUrl: string,
            realtimeWsUrl: string,
            isCommerceMode: boolean,
            kycStatus: string,
            needsOnboarding: boolean,
          ) => Promise<void>;
          clearAuthMirror?: () => Promise<void>;
        }
      | undefined;
    if (!signedIn || !p) {
      void mod?.clearAuthMirror?.();
      return;
    }
    void mod?.persistAuthMirror?.(
      p,
      String(user?.id ?? "").trim(),
      true,
      displayName,
      balanceFcfa,
      String(avatarUrl ?? ""),
      API_BASE_URL,
      token,
      ASSETS_CDN_URL,
      REALTIME_WS_URL,
      isCommerceMode,
      kycStatus,
      needsOnboarding,
    );
  });
}

export function mirrorShellAuthFromCache(): void {
  mirrorShellAuthToNativeDisk(getAccessToken(), getUserSnapshot());
}
