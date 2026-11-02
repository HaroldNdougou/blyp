import {
  encodeCashierSessionManuf,
} from "@/lib/ble/payReceiptChunkCodec";
import {
  BLYP_BLE_COMPANY_ID,
  BLYP_BLE_SERVICE_UUID,
} from "@/lib/ble/constants";
import { isBleAdvertiserNativeAvailable } from "@/lib/ble/nativeAvailable";
import { prepareBleRadio } from "@/lib/ble/prepareRadio";
import { withTimeout } from "@/lib/ble/timeout";

const SESSION_ROTATE_MS = 45_000;
const RELAY_SLOT_MS = 180;

let sessionId = (Math.random() * 0xffffffff) >>> 0;
let sessionStartedAt = Date.now();
let advertiseTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let currentAccountId: string | null = null;

export function getActiveCashierSessionId(): number {
  return sessionId >>> 0;
}

export function isCashierSessionValid(receiptSession: number | null | undefined): boolean {
  if (receiptSession == null) return false;
  return (receiptSession >>> 0) === (sessionId >>> 0);
}

function bumpSessionIfStale(): void {
  if (Date.now() - sessionStartedAt < SESSION_ROTATE_MS) return;
  sessionId = (Math.random() * 0xffffffff) >>> 0;
  sessionStartedAt = Date.now();
}

async function pulseAdvertise(accountId: string): Promise<void> {
  bumpSessionIfStale();
  const manuf = encodeCashierSessionManuf({
    sessionId,
    accountId,
  });
  if (!manuf) return;
  if (!isBleAdvertiserNativeAvailable()) return;
  const adv = await import("react-native-ble-advertiser").catch(() => null);
  if (!adv) return;
  const radio = await prepareBleRadio({ advertise: true, forcePrompt: false });
  if (radio !== "granted") return;
  try {
    adv.setCompanyId(BLYP_BLE_COMPANY_ID);
    await withTimeout(adv.stopBroadcast(), 300, undefined);
    await withTimeout(
      adv.broadcast(BLYP_BLE_SERVICE_UUID, manuf, {
        connectable: false,
        includeDeviceName: false,
        includeTxPowerLevel: false,
        includeServiceUuid: false,
      } as Parameters<typeof adv.broadcast>[2]).then(() => true),
      4_000,
      false,
    );
    await new Promise((r) => setTimeout(r, RELAY_SLOT_MS));
    await withTimeout(adv.stopBroadcast(), 300, undefined);
  } catch {
    /* ignore */
  }
}

export function startCashierSessionAdvertise(accountId: string): void {
  stopCashierSessionAdvertise();
  currentAccountId = accountId;
  running = true;
  sessionStartedAt = Date.now();
  void pulseAdvertise(accountId);
  advertiseTimer = setInterval(() => {
    if (!running || !currentAccountId) return;
    void pulseAdvertise(currentAccountId);
  }, SESSION_ROTATE_MS);
}

export function stopCashierSessionAdvertise(): void {
  running = false;
  currentAccountId = null;
  if (advertiseTimer) {
    clearInterval(advertiseTimer);
    advertiseTimer = null;
  }
  void import("react-native-ble-advertiser")
    .then((adv) => withTimeout(adv.stopBroadcast(), 300, undefined))
    .catch(() => {});
}
