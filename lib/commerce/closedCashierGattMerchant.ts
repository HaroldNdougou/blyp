import {
  isClosedCashierGattNativeAvailable,
  nativeStartClosedCashier,
  nativeStopClosedCashier,
  subscribeNativeCashierReceipt,
} from "@/lib/ble/cashierGattNative";

let activeSessionId = 0;

export function getMerchantClosedCashierSessionId(): number {
  return activeSessionId >>> 0;
}

export async function startMerchantClosedCashierGatt(
  merchantAccountId: string,
): Promise<boolean> {
  if (!isClosedCashierGattNativeAvailable()) return false;
  activeSessionId = (Math.random() * 0xffffffff) >>> 0;
  return nativeStartClosedCashier(activeSessionId, merchantAccountId);
}

export async function stopMerchantClosedCashierGatt(): Promise<void> {
  await nativeStopClosedCashier();
  activeSessionId = 0;
}

export function subscribeMerchantClosedCashierReceipt(
  onReceiptJson: (json: string) => void,
): () => void {
  return subscribeNativeCashierReceipt(onReceiptJson);
}
