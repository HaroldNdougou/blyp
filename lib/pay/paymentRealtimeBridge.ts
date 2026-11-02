import type { PaymentReceivedPushData } from "@/lib/push/handleIncoming";

type Handler = (data: PaymentReceivedPushData) => void;

let handler: Handler | null = null;

export function registerPaymentRealtimeHandler(next: Handler | null): void {
  handler = next;
}

/** WebSocket / FCM → même chemin que la notif pay. */
export function dispatchPaymentReceived(data: PaymentReceivedPushData): void {
  handler?.(data);
}
