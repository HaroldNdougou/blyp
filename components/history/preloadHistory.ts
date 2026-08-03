import type { ComponentType } from "react";

type HistoryBody = ComponentType;

let cached: HistoryBody | null = null;
let pending: Promise<HistoryBody> | null = null;

/** Précharge le corps lourd (FlashList) hors chemin critique Pay. */
export function preloadHistoryScreen(): Promise<HistoryBody> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = import("@/components/history/HistoryScreen").then((m) => {
      cached = m.default;
      return m.default;
    });
  }
  return pending;
}

export function getPreloadedHistoryScreen(): HistoryBody | null {
  return cached;
}
