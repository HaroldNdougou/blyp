import { API_BASE_URL, ASSETS_CDN_URL, REALTIME_WS_URL } from "@/lib/config";
import { formatRegistrationFullName } from "@/lib/profile/parseRegistrationFullName";
import type { ApiUser } from "@/lib/api/types";
import { Platform } from "react-native";

type ShellLaunchPayload = {
  route: string;
  hideTabBar: boolean;
  payDigits?: string;
  pendingPayFcfa?: number;
  returnToShell?: boolean;
  conversationId?: string;
  transferId?: string;
};

let rnIslandHideTabBar = false;

export function isRnIslandHideTabBar(): boolean {
  return rnIslandHideTabBar;
}

export function setRnIslandHideTabBar(hide: boolean): void {
  rnIslandHideTabBar = hide;
}

export async function consumeNativeShellLaunch(): Promise<ShellLaunchPayload | null> {
  if (Platform.OS !== "android") return null;
  try {
    const { NativeModules } = await import("react-native");
    const mod = NativeModules.BlypNativeShell as
      | {
          consumeShellLaunch?: () => Promise<ShellLaunchPayload | null>;
        }
      | undefined;
    if (!mod?.consumeShellLaunch) return null;
    const payload = await mod.consumeShellLaunch();
    if (!payload?.route) return null;
    if (payload.hideTabBar) setRnIslandHideTabBar(true);
    return payload;
  } catch {
    return null;
  }
}

export function hideNativeMessagesLoading(): void {
  if (Platform.OS !== "android") return;
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | { hideMessagesLoading?: () => Promise<void> }
      | undefined;
    void mod?.hideMessagesLoading?.();
  });
}

export async function openNativeShellPreview(): Promise<void> {
  if (Platform.OS !== "android") return;
  const { NativeModules } = await import("react-native");
  const mod = NativeModules.BlypNativeShell as
    | { openNativeShell?: () => Promise<void> }
    | undefined;
  await mod?.openNativeShell?.();
}

export function syncNativeShellSession(
  phone: string | null | undefined,
  token: string | null | undefined,
  user: ApiUser | null | undefined,
): void {
  if (Platform.OS !== "android") return;
  const signedIn = Boolean(token?.trim());
  const p = String(phone ?? user?.phone ?? "").trim();
  const displayName = user ? formatRegistrationFullName(user) : "";
  const balanceFcfa = Math.floor(Number(user?.balanceFcfa) || 0);
  const avatarUrl = user?.avatarUrl ?? "";
  const isCommerceMode = user?.activeContext?.type === "commerce";
  const kycStatus = String(user?.kycStatus ?? "none");
  const needsOnboarding = Boolean(user?.needsOnboarding);
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | {
          syncSession?: (
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
          syncInstallDeviceId?: (installDeviceId: string) => Promise<void>;
        }
      | undefined;
    void import("@/lib/push/deviceId").then(({ getOrCreatePushDeviceId }) =>
      getOrCreatePushDeviceId().then((installDeviceId) => {
        void mod?.syncSession?.(
          p,
          String(user?.id ?? "").trim(),
          signedIn,
          displayName,
          balanceFcfa,
          String(avatarUrl ?? ""),
          API_BASE_URL,
          signedIn ? String(token ?? "") : "",
          ASSETS_CDN_URL,
          REALTIME_WS_URL,
          isCommerceMode,
          kycStatus,
          needsOnboarding,
        );
        void mod?.syncInstallDeviceId?.(installDeviceId);
      }),
    );
  });
}

/** Adopte la session écrite par la connexion OTP native (îlot Messages). */
export async function consumeNativeShellAuthForJs(): Promise<{
  accessToken: string;
  refreshToken: string | null;
  user: ApiUser;
  pendingPin: string | null;
} | null> {
  if (Platform.OS !== "android") return null;
  try {
    const { NativeModules } = await import("react-native");
    const mod = NativeModules.BlypNativeShell as
      | {
          consumeShellAuthForJs?: () => Promise<{
            accessToken?: string;
            refreshToken?: string | null;
            userJson?: string;
            pendingPin?: string | null;
          } | null>;
        }
      | undefined;
    const raw = await mod?.consumeShellAuthForJs?.();
    if (!raw?.accessToken?.trim() || !raw.userJson?.trim()) return null;
    const { apiUserFromJsonString } = await import("@/lib/auth/authSession");
    const user = apiUserFromJsonString(raw.userJson);
    if (!user) return null;
    return {
      accessToken: raw.accessToken.trim(),
      refreshToken: raw.refreshToken?.trim() || null,
      user,
      pendingPin: raw.pendingPin?.replace(/\D/g, "").slice(0, 4) || null,
    };
  } catch {
    return null;
  }
}

/** Coque → îlot RN : revenir sur la coque native. */
type ShellRnHandoff =
  | "deposit"
  | "messages"
  | "pay"
  | "receipts"
  | "documents"
  | "kyc"
  | "profile";
let shellRnHandoff: ShellRnHandoff | null = null;
const handoffListeners = new Set<() => void>();

function emitHandoffChange(): void {
  for (const fn of handoffListeners) fn();
}

export function subscribeNativeShellHandoff(listener: () => void): () => void {
  handoffListeners.add(listener);
  return () => {
    handoffListeners.delete(listener);
  };
}

export function armNativeShellDepositHandoff(): void {
  shellRnHandoff = "deposit";
  emitHandoffChange();
}

export function armNativeShellMessagesHandoff(): void {
  shellRnHandoff = "messages";
  emitHandoffChange();
}

export function armNativeShellPayHandoff(): void {
  shellRnHandoff = "pay";
  emitHandoffChange();
}

export function armNativeShellReceiptsHandoff(): void {
  shellRnHandoff = "receipts";
  emitHandoffChange();
}

export function armNativeShellDocumentsHandoff(): void {
  shellRnHandoff = "documents";
  emitHandoffChange();
}

export function armNativeShellKycHandoff(): void {
  shellRnHandoff = "kyc";
  emitHandoffChange();
}

export function armNativeShellProfileHandoff(): void {
  shellRnHandoff = "profile";
  emitHandoffChange();
}

export function isNativeShellRouteScreenHandoff(): boolean {
  return (
    shellRnHandoff === "deposit" ||
    shellRnHandoff === "receipts" ||
    shellRnHandoff === "documents" ||
    shellRnHandoff === "kyc"
  );
}

export function isNativeShellProfileHandoff(): boolean {
  return shellRnHandoff === "profile";
}

export function isNativeShellPayHandoff(): boolean {
  return shellRnHandoff === "pay";
}

export function getNativeShellHandoff(): ShellRnHandoff | null {
  return shellRnHandoff;
}

async function prepareShellReturn(options?: { syncPay?: boolean }): Promise<void> {
  const { refreshBeforeNativeShellReturn } = await import(
    "@/lib/nativeShell/shellReturnRefresh"
  );
  await refreshBeforeNativeShellReturn(options);
}

async function finishNativeShellHandoff(expected: ShellRnHandoff): Promise<boolean> {
  if (shellRnHandoff !== expected || Platform.OS !== "android") return false;
  shellRnHandoff = null;
  setRnIslandHideTabBar(false);
  emitHandoffChange();
  try {
    const { NativeModules } = await import("react-native");
    const mod = NativeModules.BlypNativeShell as
      | { returnToNativeShell?: () => Promise<void> }
      | undefined;
    if (!mod?.returnToNativeShell) return false;
    await mod.returnToNativeShell();
    return true;
  } catch {
    return false;
  }
}

export async function returnToNativeShellAfterWelcome(): Promise<boolean> {
  const { getAccessToken, getUserSnapshot } = await import(
    "@/lib/auth/authSession"
  );
  syncNativeShellSession(getAccessToken(), getUserSnapshot());
  const { mirrorShellAuthFromCache } = await import("@/lib/auth/mirrorShellAuth");
  mirrorShellAuthFromCache();
  return finishNativeShellHandoff("welcome");
}

export async function returnToNativeShellAfterDeposit(): Promise<boolean> {
  return returnToNativeShellFromRouteScreen();
}

export async function returnToNativeShellAfterMessages(): Promise<boolean> {
  await prepareShellReturn();
  return finishNativeShellHandoff("messages");
}

/** Fil ouvert directement depuis la coque (pas d’écran RN derrière) → retour coque. */
export async function leaveMessagesToNativeShell(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (shellRnHandoff !== "messages") armNativeShellMessagesHandoff();
  return returnToNativeShellAfterMessages();
}

export async function returnToNativeShellAfterPay(): Promise<boolean> {
  await prepareShellReturn({ syncPay: true });
  return finishNativeShellHandoff("pay");
}

export async function returnToNativeShellAfterProfile(): Promise<boolean> {
  await prepareShellReturn({ syncPay: true });
  return finishNativeShellHandoff("profile");
}

/** Dépôt, reçus, documents ouverts depuis la coque. */
export async function returnToNativeShellFromRouteScreen(): Promise<boolean> {
  const r = shellRnHandoff;
  if (r !== "deposit" && r !== "receipts" && r !== "documents" && r !== "kyc") return false;
  await prepareShellReturn({ syncPay: r === "deposit" });
  return finishNativeShellHandoff(r);
}

export function syncNativeShellMessagesUnread(totalUnread: number): void {
  if (Platform.OS !== "android") return;
  const n = Math.max(0, Math.floor(Number(totalUnread) || 0));
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | { syncMessagesUnread?: (count: number) => Promise<void> }
      | undefined;
    void mod?.syncMessagesUnread?.(n);
  });
}

export function syncNativeShellReceiptsUnread(count: number): void {
  if (Platform.OS !== "android") return;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | { syncReceiptsUnread?: (count: number) => Promise<void> }
      | undefined;
    void mod?.syncReceiptsUnread?.(n);
  });
}

/** Miroir mode caisse offline coque ↔ SecureStore (`blyp.offlineCashier.v1`). */
export function syncNativeShellOfflineCashier(
  snap: import("@/lib/commerce/offlineCashierMode").OfflineCashierModeSnapshot,
): void {
  if (Platform.OS !== "android") return;
  const json =
    snap.active && snap.commerceId
      ? JSON.stringify({
          commerceId: snap.commerceId,
          enabledAtIso: snap.enabledAtIso,
        })
      : null;
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | { syncOfflineCashierSnapshot?: (json: string | null) => Promise<void> }
      | undefined;
    void mod?.syncOfflineCashierSnapshot?.(json);
  });
}

export async function pullNativeShellOfflineCashier(): Promise<
  import("@/lib/commerce/offlineCashierMode").OfflineCashierModeSnapshot | null
> {
  if (Platform.OS !== "android") return null;
  try {
    const { NativeModules } = await import("react-native");
    const mod = NativeModules.BlypNativeShell as
      | { getOfflineCashierSnapshot?: () => Promise<string | null> }
      | undefined;
    const raw = (await mod?.getOfflineCashierSnapshot?.()) ?? null;
    if (!raw?.trim()) {
      return { active: false, commerceId: null, enabledAtIso: null };
    }
    const o = JSON.parse(raw) as {
      commerceId?: string;
      enabledAtIso?: string;
    };
    const commerceId =
      typeof o.commerceId === "string" && o.commerceId.trim()
        ? o.commerceId.trim()
        : null;
    if (!commerceId) {
      return { active: false, commerceId: null, enabledAtIso: null };
    }
    return {
      active: true,
      commerceId,
      enabledAtIso:
        typeof o.enabledAtIso === "string" ? o.enabledAtIso : null,
    };
  } catch {
    return null;
  }
}

export function syncNativeShellPendingReceiptEncashQueue(json: string): void {
  if (Platform.OS !== "android") return;
  void import("react-native").then(({ NativeModules }) => {
    const mod = NativeModules.BlypNativeShell as
      | {
          syncPendingReceiptEncashQueue?: (json: string | null) => Promise<void>;
        }
      | undefined;
    void mod?.syncPendingReceiptEncashQueue?.(json);
  });
}

export async function pullNativeShellPendingReceiptEncashQueue(): Promise<
  string | null
> {
  if (Platform.OS !== "android") return null;
  try {
    const { NativeModules } = await import("react-native");
    const mod = NativeModules.BlypNativeShell as
      | { getPendingReceiptEncashQueue?: () => Promise<string | null> }
      | undefined;
    return (await mod?.getPendingReceiptEncashQueue?.()) ?? null;
  } catch {
    return null;
  }
}
