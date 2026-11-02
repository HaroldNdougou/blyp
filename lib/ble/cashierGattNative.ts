import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type CashierGattNative = {
  startClosedCashier(sessionId: number, merchantAccountId: string): Promise<void>;
  stopClosedCashier(): Promise<void>;
  addListener: (event: string) => void;
  removeListeners: (count: number) => void;
};

const Native = NativeModules.BlypCashierGatt as CashierGattNative | undefined;

export function isClosedCashierGattNativeAvailable(): boolean {
  return Platform.OS === "android" && Boolean(Native?.startClosedCashier);
}

export async function nativeStartClosedCashier(
  sessionId: number,
  merchantAccountId: string,
): Promise<boolean> {
  if (!Native?.startClosedCashier) return false;
  try {
    await Native.startClosedCashier(sessionId >>> 0, merchantAccountId);
    return true;
  } catch {
    return false;
  }
}

export async function nativeStopClosedCashier(): Promise<void> {
  try {
    await Native?.stopClosedCashier?.();
  } catch {
    /* ignore */
  }
}

export function subscribeNativeCashierReceipt(
  onReceiptJson: (json: string) => void,
): () => void {
  if (!Native) return () => {};
  const emitter = new NativeEventEmitter(Native as unknown as {
    addListener: (e: string) => void;
    removeListeners: (n: number) => void;
  });
  const sub = emitter.addListener(
    "cashierReceiptReceived",
    (payload: { receiptJson?: string }) => {
      const raw = String(payload?.receiptJson ?? "");
      if (raw) onReceiptJson(raw);
    },
  );
  return () => sub.remove();
}
