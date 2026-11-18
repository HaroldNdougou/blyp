/** Rafraîchir le profil avant retour à la coque (solde, KYC, nom…). */
let refreshFn: (() => Promise<void>) | null = null;

export function registerNativeShellReturnRefresh(
  fn: (() => Promise<void>) | null,
): void {
  refreshFn = fn;
}

export async function refreshBeforeNativeShellReturn(options?: {
  syncPay?: boolean;
}): Promise<void> {
  if (refreshFn) {
    try {
      await refreshFn();
    } catch {
      /* ignore */
    }
  }
  const { Platform } = await import("react-native");
  if (Platform.OS === "android") {
    const { pullNativeShellOfflineCashier } = await import("@/lib/nativeShell");
    const { mergeNativeOfflineCashierFromShell } = await import(
      "@/lib/commerce/offlineCashierMode"
    );
    await mergeNativeOfflineCashierFromShell(pullNativeShellOfflineCashier);
    const { mergeNativePendingReceiptEncashFromShell } = await import(
      "@/lib/commerce/pendingReceiptEncashQueue"
    );
    const { pullNativeShellPendingReceiptEncashQueue } = await import(
      "@/lib/nativeShell"
    );
    await mergeNativePendingReceiptEncashFromShell(
      pullNativeShellPendingReceiptEncashQueue,
    );
  }
  if (!options?.syncPay) return;
  const { getUserSnapshot } = await import("@/lib/auth/authSession");
  const { syncShellPayRuntime } = await import("@/lib/pay/syncShellPayRuntime");
  await syncShellPayRuntime(getUserSnapshot()).catch(() => {});
}
