/**
 * Observabilité perf légère (point 10) — mesures locales, logs en __DEV__.
 */
type MarkRec = { name: string; t0: number };

const open = new Map<string, MarkRec>();
const samples: { name: string; ms: number; at: string }[] = [];

export function perfMarkStart(name: string): void {
  open.set(name, { name, t0: Date.now() });
}

export function perfMarkEnd(name: string): number | null {
  const rec = open.get(name);
  if (!rec) return null;
  open.delete(name);
  const ms = Date.now() - rec.t0;
  samples.push({ name, ms, at: new Date().toISOString() });
  if (samples.length > 40) samples.shift();
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[perf] ${name}: ${ms}ms`);
  }
  return ms;
}

/** Derniers échantillons (debug / futur export). */
export function getPerfSamples() {
  return [...samples];
}
