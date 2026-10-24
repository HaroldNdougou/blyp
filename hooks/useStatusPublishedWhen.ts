import { formatStatusPublishedWhen } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";

const TICK_MS = 15_000;
const TICK_MAX_AGE_MS = 25 * 60 * 60 * 1000;

/** Libellé date statut qui se rafraîchit (Maintenant → il y a N min → Aujourd'hui, …). */
export function useStatusPublishedWhen(iso: string): string {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return;
    const age = Date.now() - t;
    if (age > TICK_MAX_AGE_MS) return;
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [iso]);

  return useMemo(
    () => formatStatusPublishedWhen(iso, nowMs),
    [iso, nowMs],
  );
}
