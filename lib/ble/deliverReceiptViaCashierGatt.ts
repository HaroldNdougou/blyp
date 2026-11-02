import {
  BLYP_CASHIER_GATT_RECEIPT_CHAR_UUID,
  BLYP_CASHIER_GATT_SERVICE_UUID,
  BLYP_CASHIER_GATT_SESSION_CHAR_UUID,
  CASHIER_GATT_CONNECT_MS,
  CASHIER_GATT_SCAN_MS,
} from "@/lib/ble/cashierGattConstants";
import { prepareBleRadio } from "@/lib/ble/prepareRadio";
import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import { verifyCommercePaymentReceiptSync } from "@/lib/pay/paymentReceipt";

function parseSessionPayload(base64: string | null | undefined): {
  sessionId: number;
  accountId: string;
} | null {
  if (!base64) return null;
  try {
    const bin = atob(base64);
    if (bin.length < 4) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const sessionId =
      bytes[0]! |
      (bytes[1]! << 8) |
      (bytes[2]! << 16) |
      (bytes[3]! << 24);
    let acc = "";
    for (let i = 4; i < Math.min(bytes.length, 4 + 48); i++) {
      const b = bytes[i]!;
      if (b === 0) break;
      if (b >= 0x20 && b <= 0x7e) acc += String.fromCharCode(b);
    }
    if (!acc.startsWith("BLYP-C-")) return null;
    return { sessionId: sessionId >>> 0, accountId: acc.trim().toUpperCase() };
  } catch {
    return null;
  }
}

async function withBleManager<T>(
  fn: (mgr: import("react-native-ble-plx").BleManager) => Promise<T>,
): Promise<T | null> {
  const radio = await prepareBleRadio({ forcePrompt: false });
  if (radio !== "granted") return null;
  const { BleManager } = await import("react-native-ble-plx");
  const mgr = new BleManager();
  try {
    return await fn(mgr);
  } finally {
    try {
      mgr.destroy();
    } catch {
      /* ignore */
    }
  }
}

export async function readCashierSessionViaGatt(
  merchantAccountId: string,
): Promise<number | null> {
  const target = merchantAccountId.trim().toUpperCase();
  if (!target) return null;

  return withBleManager(async (mgr) => {
    const found: { id: string; rssi: number }[] = [];
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          mgr.stopDeviceScan();
        } catch {
          /* ignore */
        }
        resolve();
      }, CASHIER_GATT_SCAN_MS);
      mgr.startDeviceScan(
        [BLYP_CASHIER_GATT_SERVICE_UUID],
        { allowDuplicates: false },
        (err, device) => {
          if (err || !device) return;
          found.push({ id: device.id, rssi: device.rssi ?? -100 });
        },
      );
    });

    found.sort((a, b) => b.rssi - a.rssi);
    for (const hit of found.slice(0, 4)) {
      try {
        const device = await mgr.connectToDevice(hit.id, {
          timeout: CASHIER_GATT_CONNECT_MS,
        });
        try {
          await device.requestMTU(512);
        } catch {
          /* ignore */
        }
        await device.discoverAllServicesAndCharacteristics();
        const read = await device.readCharacteristicForService(
          BLYP_CASHIER_GATT_SERVICE_UUID,
          BLYP_CASHIER_GATT_SESSION_CHAR_UUID,
        );
        const parsed = parseSessionPayload(read.value);
        await device.cancelConnection();
        if (parsed && parsed.accountId === target) {
          return parsed.sessionId;
        }
      } catch {
        /* try next */
      }
    }
    return null;
  });
}

export async function deliverReceiptViaCashierGatt(input: {
  receipt: CommercePaymentReceipt;
  merchantAccountId: string;
}): Promise<boolean> {
  if (!verifyCommercePaymentReceiptSync(input.receipt)) return false;
  const target = input.merchantAccountId.trim().toUpperCase();
  const payload = JSON.stringify(input.receipt);

  const result = await withBleManager(async (mgr) => {
    const found: { id: string; rssi: number }[] = [];
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          mgr.stopDeviceScan();
        } catch {
          /* ignore */
        }
        resolve();
      }, CASHIER_GATT_SCAN_MS);
      mgr.startDeviceScan(
        [BLYP_CASHIER_GATT_SERVICE_UUID],
        { allowDuplicates: false },
        (err, device) => {
          if (err || !device) return;
          found.push({ id: device.id, rssi: device.rssi ?? -100 });
        },
      );
    });

    found.sort((a, b) => b.rssi - a.rssi);
    for (const hit of found.slice(0, 4)) {
      try {
        const device = await mgr.connectToDevice(hit.id, {
          timeout: CASHIER_GATT_CONNECT_MS,
        });
        try {
          await device.requestMTU(512);
        } catch {
          /* ignore */
        }
        await device.discoverAllServicesAndCharacteristics();
        const read = await device.readCharacteristicForService(
          BLYP_CASHIER_GATT_SERVICE_UUID,
          BLYP_CASHIER_GATT_SESSION_CHAR_UUID,
        );
        const parsed = parseSessionPayload(read.value);
        if (!parsed || parsed.accountId !== target) {
          await device.cancelConnection();
          continue;
        }
        const b64 = bytesToBase64(new TextEncoder().encode(payload));
        await device.writeCharacteristicWithResponseForService(
          BLYP_CASHIER_GATT_SERVICE_UUID,
          BLYP_CASHIER_GATT_RECEIPT_CHAR_UUID,
          b64,
        );
        await device.cancelConnection();
        return true;
      } catch {
        /* try next */
      }
    }
    return false;
  });

  return result === true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function deliverReceiptViaCashierGattDeferred(input: {
  receipt: CommercePaymentReceipt | null | undefined;
  merchantAccountId: string | null | undefined;
}): void {
  if (!input.receipt || !input.merchantAccountId) return;
  void deliverReceiptViaCashierGatt({
    receipt: input.receipt,
    merchantAccountId: input.merchantAccountId,
  });
}
