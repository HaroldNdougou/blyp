import { waitTaxiBroadcastStopped } from "@/lib/ble/broadcastStopGate";
import {
  getBleTaxiPeerSnapshot,
  startTaxiScan,
  subscribeBleTaxiPeer,
} from "@/lib/ble/scan";
import { withTimeout } from "@/lib/ble/timeout";
import type { BleTaxiPeer } from "@/lib/ble/types";

const DEFAULT_TIMEOUT_MS = 3_200;

/**
 * Après OFF diffusion : relance le scan et attend le 1er peer (hors soi).
 * UI Pay : pas d’alerte « désactive Recevoir » — le tap Payer enchaîne.
 */
export async function waitForNearbyPayPeer(opts: {
  isOwn: (peer: BleTaxiPeer) => boolean;
  timeoutMs?: number;
}): Promise<BleTaxiPeer | null> {
  const usable = (p: BleTaxiPeer | null): BleTaxiPeer | null =>
    p && !opts.isOwn(p) ? p : null;

  const already = usable(getBleTaxiPeerSnapshot());
  if (already) return already;

  await withTimeout(waitTaxiBroadcastStopped(), 900, undefined);

  const status = await startTaxiScan();
  if (
    status === "denied" ||
    status === "powered_off" ||
    status === "unavailable" ||
    status === "error"
  ) {
    return null;
  }

  const afterStart = usable(getBleTaxiPeerSnapshot());
  if (afterStart) return afterStart;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (peer: BleTaxiPeer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(peer);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const unsub = subscribeBleTaxiPeer((p) => {
      const hit = usable(p);
      if (hit) finish(hit);
    });
  });
}
