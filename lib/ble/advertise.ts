import {
  BLYP_BLE_COMPANY_ID,
  BLYP_BLE_SERVICE_UUID,
} from "@/lib/ble/constants";
import { isBleAdvertiserNativeAvailable } from "@/lib/ble/nativeAvailable";
import { encodeBleTaxiManufBytes } from "@/lib/ble/payload";
import { prepareBleRadio } from "@/lib/ble/prepareRadio";
import { setBleBroadcasting } from "@/lib/ble/radioMode";
import { stopBleBroadcastForeground } from "@/lib/ble/foregroundService";
import { stopTaxiScan } from "@/lib/ble/scan";
import type { BleAdvertiseStatus } from "@/lib/ble/types";

export type StartAdvertiseInput = {
  accountId: string;
  phone: string;
};

export type StartAdvertiseResult =
  | { ok: true; status: "broadcasting" }
  | { ok: false; status: BleAdvertiseStatus; message?: string };

/** Invalide toute pub en cours / en train de démarrer. */
let broadcastGeneration = 0;
/** Purge OEM orpheline une fois au boot — pas à chaque ouverture Profil (casse le scan). */
let orphanPurgeDone = false;

/** Chaîne les stops (toggle rapide / remount) sans empiler le travail OEM. */
let stopChain: Promise<void> = Promise.resolve();

const STOP_GAP_MS = [0, 55, 140] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadAdvertiser(): Promise<typeof import("react-native-ble-advertiser") | null> {
  if (!isBleAdvertiserNativeAvailable()) return null;
  try {
    return await import("react-native-ble-advertiser");
  } catch {
    return null;
  }
}

async function nativeStop(
  adv: typeof import("react-native-ble-advertiser"),
): Promise<void> {
  try {
    await adv.stopBroadcast();
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[ble] stopBroadcast",
        e instanceof Error ? e.message : e,
      );
    }
  }
}

/**
 * Stop OEM robuste (Xiaomi/MIUI ignore souvent le 1er coup).
 * Abandonne si une nouvelle génération (start / autre stop) a pris le relais.
 */
async function hardNativeStop(
  adv: typeof import("react-native-ble-advertiser"),
  gen: number,
): Promise<void> {
  for (let i = 0; i < STOP_GAP_MS.length; i++) {
    if (gen !== broadcastGeneration) return;
    const gap = STOP_GAP_MS[i];
    if (gap > 0) await sleep(gap);
    if (gen !== broadcastGeneration) return;
    await nativeStop(adv);
  }
}

export async function startTaxiBroadcast(
  input: StartAdvertiseInput,
): Promise<StartAdvertiseResult> {
  /** Purge boot / toggle OFF — attendre avant start (sinon MIUI → erreur ou idle). */
  await stopChain;

  const adv = await loadAdvertiser();
  if (!adv) {
    return {
      ok: false,
      status: "unavailable",
      message: "Module advertise absent — rebuild natif requis",
    };
  }

  const radio = await prepareBleRadio({ advertise: true });
  if (radio === "powered_off") {
    return { ok: false, status: "powered_off" };
  }
  if (radio !== "granted") {
    return {
      ok: false,
      status: radio === "unavailable" ? "unavailable" : "denied",
    };
  }

  const manuf = encodeBleTaxiManufBytes(input);
  if (!manuf) {
    if (__DEV__) {
      console.warn("[ble] encode manuf failed", {
        accountId: input.accountId,
        phone: input.phone,
      });
    }
    return {
      ok: false,
      status: "error",
      message: "INVALID_ACCOUNT",
    };
  }

  /** Coupe toute pub orpheline puis le scan. */
  await nativeStop(adv);
  await stopTaxiScan();
  await stopChain;

  const gen = ++broadcastGeneration;
  setBleBroadcasting(true);

  try {
    adv.setCompanyId(BLYP_BLE_COMPANY_ID);
    await adv.broadcast(BLYP_BLE_SERVICE_UUID, manuf, {
      connectable: false,
      includeDeviceName: false,
      includeTxPowerLevel: false,
      includeServiceUuid: false,
      advertiseMode: 2, // LOW_LATENCY
      txPowerLevel: 3, // HIGH
    } as Parameters<typeof adv.broadcast>[2]);

    /** OFF pendant le await → ne pas laisser la pub active. */
    if (gen !== broadcastGeneration) {
      setBleBroadcasting(false);
      await stopTaxiBroadcast();
      return { ok: false, status: "idle" };
    }

    if (__DEV__) {
      console.log("[ble] broadcast ON", input.accountId, "bytes=", manuf.length);
    }
    return { ok: true, status: "broadcasting" };
  } catch (e) {
    setBleBroadcasting(false);
    await stopTaxiBroadcast();
    const message = e instanceof Error ? e.message : String(e);
    if (__DEV__) console.warn("[ble] broadcast fail", message);
    if (/power|bluetooth|adapter|disabled/i.test(message)) {
      return { ok: false, status: "powered_off", message };
    }
    return { ok: false, status: "error", message };
  }
}

/**
 * Coupe vraiment la diffusion. Safe à appeler en rafale (OFF / reload / background).
 * UI doit passer OFF immédiatement ; cet appel peut rester fire-and-forget.
 */
/**
 * Après reload natif : la pub OEM peut rester ON alors que le switch JS est OFF.
 * Une seule fois par session, avant que Pay ne scanne.
 */
export function purgeOrphanTaxiBroadcastOnce(): void {
  if (orphanPurgeDone) return;
  orphanPurgeDone = true;
  void stopTaxiBroadcast();
}

export function stopTaxiBroadcast(): Promise<void> {
  broadcastGeneration += 1;
  const gen = broadcastGeneration;
  setBleBroadcasting(false);
  void stopBleBroadcastForeground();

  const next = stopChain.then(async () => {
    /** Un stop plus récent (ou un start) a pris le relais. */
    if (gen !== broadcastGeneration) return;
    const adv = await loadAdvertiser();
    if (!adv) {
      if (__DEV__) console.log("[ble] broadcast OFF (no module)");
      return;
    }
    await hardNativeStop(adv, gen);
    if (gen === broadcastGeneration && __DEV__) {
      console.log("[ble] broadcast OFF");
    }
  });
  stopChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
