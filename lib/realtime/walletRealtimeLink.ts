/**
 * WebSocket wallet — même hub binaire que la messagerie.
 */
import {
  acquireRealtimeHub,
  kickRealtimeHub,
  releaseRealtimeHub,
} from "@/lib/realtime/realtimeHub";

export function ensureWalletRealtimeLink(token: string | null) {
  if (!token) {
    stopWalletRealtimeLink();
    return;
  }
  acquireRealtimeHub("wallet", token);
}

export function kickWalletRealtimeLink(): void {
  kickRealtimeHub();
}

export function stopWalletRealtimeLink() {
  releaseRealtimeHub("wallet");
}
