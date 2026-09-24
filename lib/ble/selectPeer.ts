import type { BleTaxiPeer } from "@/lib/ble/types";

export type BlePeerSelectorOptions = {
  /** Sans pub depuis tant de ms → retiré. */
  staleMs: number;
  minRssi: number;
  /**
   * Écart RSSI (dB) pour voler la place au taxi courant.
   * Évite le flash entre deux pubs proches.
   */
  hysteresisDb: number;
};

/**
 * Sélection du taxi le plus proche (RSSI max) avec hystérésis.
 * Réactif : plus de pubs → disparition ; nouvelle pub → affichage.
 */
export function createBlePeerSelector(opts: BlePeerSelectorOptions) {
  const peers = new Map<string, BleTaxiPeer>();
  let selectedId: string | null = null;

  function prune(now: number) {
    for (const [id, p] of peers) {
      if (now - p.lastSeenAt > opts.staleMs) peers.delete(id);
    }
    if (selectedId && !peers.has(selectedId)) selectedId = null;
  }

  function strongestFresh(now: number): BleTaxiPeer | null {
    let best: BleTaxiPeer | null = null;
    for (const p of peers.values()) {
      if (now - p.lastSeenAt > opts.staleMs) continue;
      if (p.rssi < opts.minRssi) continue;
      if (!best || p.rssi > best.rssi) best = p;
    }
    return best;
  }

  function resolve(now: number): BleTaxiPeer | null {
    prune(now);
    const top = strongestFresh(now);

    const current =
      selectedId != null ? (peers.get(selectedId) ?? null) : null;
    const currentFresh =
      current && now - current.lastSeenAt <= opts.staleMs ? current : null;

    if (!top) {
      selectedId = null;
      return null;
    }

    if (!currentFresh) {
      selectedId = top.accountId;
      return { ...top };
    }

    if (top.accountId === currentFresh.accountId) {
      selectedId = currentFresh.accountId;
      return { ...currentFresh };
    }

    if (top.rssi >= currentFresh.rssi + opts.hysteresisDb) {
      selectedId = top.accountId;
      return { ...top };
    }

    selectedId = currentFresh.accountId;
    return { ...currentFresh };
  }

  return {
    clear() {
      peers.clear();
      selectedId = null;
    },

    noteSighting(peer: BleTaxiPeer): BleTaxiPeer | null {
      if (peer.rssi < opts.minRssi) return resolve(Date.now());
      const prev = peers.get(peer.accountId);
      /** 1ère vue = RSSI brut (captage immédiat) ; ensuite EMA réactif. */
      const rssi =
        prev != null
          ? Math.round(prev.rssi * 0.2 + peer.rssi * 0.8)
          : peer.rssi;
      peers.set(peer.accountId, { ...peer, rssi });
      return resolve(Date.now());
    },

    tick(): BleTaxiPeer | null {
      return resolve(Date.now());
    },

    snapshot(): BleTaxiPeer | null {
      if (selectedId == null) return null;
      const p = peers.get(selectedId);
      return p ? { ...p } : null;
    },
  };
}

export type BlePeerSelector = ReturnType<typeof createBlePeerSelector>;
