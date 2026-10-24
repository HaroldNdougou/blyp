import { fetchSoaDayReport } from "@/lib/api/client";
import {
  getSoaDayReportSnapshot,
  setSoaDayReportSnapshot,
} from "@/lib/soa/soaReportCache";
import { InteractionManager } from "react-native";

let lastKey = "";
let lastAt = 0;
const MIN_MS = 8000;

export function syncSoaDayReportFromNetwork(
  token: string,
  commerceId: string,
  dayKey: string,
  opts?: { force?: boolean },
): void {
  const cid = String(commerceId ?? "").trim();
  const dk = String(dayKey ?? "").trim();
  if (!token || !cid || !dk) return;
  const gate = `${cid}::${dk}`;
  const now = Date.now();
  if (!opts?.force && gate === lastKey && now - lastAt < MIN_MS) return;
  InteractionManager.runAfterInteractions(() => {
    void fetchSoaDayReport(token, cid, dk)
      .then((report) => {
        lastKey = gate;
        lastAt = Date.now();
        setSoaDayReportSnapshot(cid, report);
      })
      .catch(() => {});
  });
}

export function readSoaDayReportOrEmpty(
  commerceId: string,
  dayKey: string,
): import("@/lib/soa/soaCar").SoaCarDayReport {
  const hit = getSoaDayReportSnapshot(commerceId, dayKey);
  if (hit) return hit;
  return { dayKey, totalFcfa: 0, tripCount: 0, trips: [] };
}
