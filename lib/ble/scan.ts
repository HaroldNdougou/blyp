import {
  BLYP_BLE_SCAN_CALLBACK_ALL_MATCHES,
  BLYP_BLE_SCAN_MODE_LOW_LATENCY,
  BLYP_PEER_MIN_RSSI,
  BLYP_PEER_RSSI_EMIT_DELTA_DB,
  BLYP_PEER_RSSI_HYSTERESIS_DB,
  BLYP_PEER_STALE_MS,
  BLYP_PEER_STALE_TICK_MS,
} from "@/lib/ble/constants";
import { base64ToBytes, bytesToHex } from "@/lib/ble/base64";
import { isBlePlxNativeAvailable } from "@/lib/ble/nativeAvailable";
import { resolveTaxiFromScan } from "@/lib/ble/payload";
import { prepareBleRadio } from "@/lib/ble/prepareRadio";
import { isBleBroadcasting } from "@/lib/ble/radioMode";
import { createBlePeerSelector } from "@/lib/ble/selectPeer";
import type { BleScanStatus, BleTaxiPeer } from "@/lib/ble/types";
import type { BleError, Device } from "react-native-ble-plx";

type PeerListener = (peer: BleTaxiPeer | null) => void;
type StatusListener = (status: BleScanStatus) => void;

let manager: import("react-native-ble-plx").BleManager | null = null;
let scanning = false;
let bestPeer: BleTaxiPeer | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
let authWarnLogged = false;
let devLogLeft = 40;
const hexLogged = new Set<string>();
const peerListeners = new Set<PeerListener>();
const statusListeners = new Set<StatusListener>();
let lastStatus: BleScanStatus = "idle";

const selector = createBlePeerSelector({
  staleMs: BLYP_PEER_STALE_MS,
  minRssi: BLYP_PEER_MIN_RSSI,
  hysteresisDb: BLYP_PEER_RSSI_HYSTERESIS_DB,
});

function emitStatus(status: BleScanStatus) {
  lastStatus = status;
  statusListeners.forEach((l) => l(status));
}

function emitPeer(peer: BleTaxiPeer | null) {
  bestPeer = peer;
  peerListeners.forEach((l) => l(peer));
}

/** Publie dès le 1er taxi ; sinon seulement si taxi / RSSI change assez. */
function publishSelection(next: BleTaxiPeer | null) {
  const prev = bestPeer;
  if (prev == null && next == null) return;

  /** Captage immédiat : null → taxi = emit synchrone, pas de seuil RSSI. */
  if (prev == null && next != null) {
    if (__DEV__) {
      console.log(
        "[ble] capture",
        next.displayName,
        "rssi=",
        next.rssi,
        next.accountId,
      );
    }
    emitPeer(next);
    return;
  }

  const sameTaxi = prev != null && next != null && prev.accountId === next.accountId;
  if (sameTaxi && Math.abs(prev.rssi - next.rssi) < BLYP_PEER_RSSI_EMIT_DELTA_DB) {
    bestPeer = next;
    return;
  }

  if (__DEV__ && prev?.accountId !== next?.accountId && next != null) {
    console.log(
      "[ble] select",
      next.displayName,
      "rssi=",
      next.rssi,
      next.accountId,
    );
  }
  emitPeer(next);
}

function sweepStalePeer() {
  publishSelection(selector.tick());
}

async function getManager(): Promise<import("react-native-ble-plx").BleManager | null> {
  if (!isBlePlxNativeAvailable()) return null;
  if (manager) return manager;
  try {
    const { BleManager } = await import("react-native-ble-plx");
    manager = new BleManager();
    return manager;
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[ble] BleManager indisponible — rebuild natif requis",
        e instanceof Error ? e.message : e,
      );
    }
    return null;
  }
}

function haltUnauthorized(reason: string) {
  if (!authWarnLogged) {
    authWarnLogged = true;
    console.warn(
      "[ble] Non autorisé — GPS ON + permission Localisation pour Blyp.",
      reason,
    );
  }
  scanning = false;
  if (manager) {
    try {
      manager.stopDeviceScan();
    } catch {
      /* ignore */
    }
  }
  if (staleTimer) {
    clearInterval(staleTimer);
    staleTimer = null;
  }
  selector.clear();
  emitPeer(null);
  emitStatus("denied");
}

function onDevice(error: BleError | null, device: Device | null) {
  if (error) {
    const msg = error.message || "";
    if (
      /not authorized|Unauthorized|permission/i.test(msg) ||
      error.errorCode === 3
    ) {
      haltUnauthorized(msg);
      return;
    }
    if (__DEV__ && !authWarnLogged) console.warn("[ble]", msg);
    return;
  }
  if (!device) return;

  const rawScan =
    (device as Device & { rawScanRecord?: string | null }).rawScanRecord ??
    null;
  const name = device.localName || device.name || "";
  const idShort = device.id?.slice?.(0, 8) ?? "?";

  if (__DEV__ && rawScan && !hexLogged.has(idShort)) {
    hexLogged.add(idShort);
    const bytes = base64ToBytes(rawScan);
    console.log(
      "[ble] raw hex",
      idShort,
      bytes ? bytesToHex(bytes).slice(0, 80) : "?",
    );
  }

  if (__DEV__ && devLogLeft > 0) {
    devLogLeft -= 1;
    console.log("[ble] seen", {
      name: name || "(sans nom)",
      rssi: device.rssi,
      hasManuf: Boolean(device.manufacturerData),
      hasRaw: Boolean(rawScan),
      id: idShort,
    });
  }

  const parsed = resolveTaxiFromScan({
    localName: device.localName,
    name: device.name,
    manufacturerData: device.manufacturerData,
    rawScanRecord: rawScan,
    serviceUUIDs: device.serviceUUIDs,
    rssi: device.rssi,
  });
  if (!parsed) return;

  publishSelection(
    selector.noteSighting({ ...parsed, lastSeenAt: Date.now() }),
  );
}

export function subscribeBleTaxiPeer(listener: PeerListener): () => void {
  peerListeners.add(listener);
  listener(bestPeer);
  return () => {
    peerListeners.delete(listener);
  };
}

export function subscribeBleScanStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(lastStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getBleTaxiPeerSnapshot(): BleTaxiPeer | null {
  return bestPeer;
}

/** Arrête le moteur de scan sans publier `idle` (évite un flash UI au refresh). */
function haltScanEngine() {
  scanning = false;
  if (staleTimer) {
    clearInterval(staleTimer);
    staleTimer = null;
  }
  if (manager) {
    try {
      manager.stopDeviceScan();
    } catch {
      /* ignore */
    }
  }
  selector.clear();
  emitPeer(null);
}

export async function startTaxiScan(): Promise<BleScanStatus> {
  if (isBleBroadcasting()) {
    if (__DEV__) console.log("[ble] scan skipped — diffusion active");
    await stopTaxiScan();
    emitStatus("idle");
    return "idle";
  }

  const mgr = await getManager();
  if (!mgr) {
    emitStatus("unavailable");
    return "unavailable";
  }

  emitStatus("starting");
  authWarnLogged = false;
  const radio = await prepareBleRadio();
  if (radio !== "granted") {
    console.warn("[ble] prepareRadio=", radio);
    const status: BleScanStatus =
      radio === "powered_off"
        ? "powered_off"
        : radio === "unavailable"
          ? "unavailable"
          : "denied";
    emitStatus(status);
    return status;
  }

  try {
    const state = await mgr.state();
    if (__DEV__) console.log("[ble] state=", state);
    if (state === "Unauthorized") {
      haltUnauthorized("BleManager.state=Unauthorized");
      return "denied";
    }
    if (state !== "PoweredOn") {
      emitStatus("powered_off");
      return "powered_off";
    }
  } catch {
    emitStatus("error");
    return "error";
  }

  if (scanning) {
    emitStatus("scanning");
    return "scanning";
  }

  selector.clear();
  emitPeer(null);
  scanning = true;
  if (__DEV__) {
    devLogLeft = 40;
    hexLogged.clear();
    console.log("[ble] scan START (nearest RSSI)");
  }
  mgr.startDeviceScan(
    null,
    {
      allowDuplicates: true,
      legacyScan: true,
      scanMode: BLYP_BLE_SCAN_MODE_LOW_LATENCY,
      callbackType: BLYP_BLE_SCAN_CALLBACK_ALL_MATCHES,
    },
    onDevice,
  );

  if (!staleTimer) {
    staleTimer = setInterval(sweepStalePeer, BLYP_PEER_STALE_TICK_MS);
  }

  emitStatus("scanning");
  return "scanning";
}

/**
 * Relance légère : re-check permissions / BT, purge la sélection, reprend le scan
 * pour le signal le plus fort actuel. Pas de passage par `idle`.
 */
export async function refreshTaxiScan(): Promise<BleScanStatus> {
  if (isBleBroadcasting()) {
    if (__DEV__) console.log("[ble] refresh skipped — diffusion active");
    return lastStatus === "idle" ? "idle" : lastStatus;
  }
  if (__DEV__) console.log("[ble] scan REFRESH");
  haltScanEngine();
  return startTaxiScan();
}

export async function stopTaxiScan(): Promise<void> {
  haltScanEngine();
  emitStatus("idle");
}
