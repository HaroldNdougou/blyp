import type { SoaCarDayReport } from "@/lib/soa/soaCar";

const cache = new Map<string, SoaCarDayReport>();
const listeners = new Set<() => void>();

function cacheKey(commerceId: string, dayKey: string): string {
  return `${String(commerceId).trim()}::${String(dayKey).trim()}`;
}

function notify() {
  listeners.forEach((l) => l());
}

function reportsEqual(a: SoaCarDayReport, b: SoaCarDayReport): boolean {
  if (a.dayKey !== b.dayKey || a.totalFcfa !== b.totalFcfa) return false;
  if (a.trips.length !== b.trips.length) return false;
  for (let i = 0; i < a.trips.length; i++) {
    const x = a.trips[i];
    const y = b.trips[i];
    if (
      x.tripId !== y.tripId ||
      x.isActive !== y.isActive ||
      x.totalFcfa !== y.totalFcfa
    ) {
      return false;
    }
  }
  return true;
}

export function getSoaDayReportSnapshot(
  commerceId: string,
  dayKey: string,
): SoaCarDayReport | undefined {
  return cache.get(cacheKey(commerceId, dayKey));
}

export function setSoaDayReportSnapshot(
  commerceId: string,
  report: SoaCarDayReport,
): void {
  const key = cacheKey(commerceId, report.dayKey);
  const prev = cache.get(key);
  if (prev && reportsEqual(prev, report)) {
    return;
  }
  cache.set(key, report);
  notify();
}

export function subscribeSoaDayReport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
