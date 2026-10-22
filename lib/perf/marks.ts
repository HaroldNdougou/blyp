/**
 * Observabilité perf légère (point 10) — mesures locales, logs en __DEV__.
 */
type MarkRec = { name: string; t0: number };

const open = new Map<string, MarkRec>();
const samples: { name: string; ms: number; at: string }[] = [];
let chatOpenT0: number | null = null;

export function perfMarkStart(name: string): void {
  const t0 = Date.now();
  open.set(name, { name, t0 });
  if (name === "chat_open") chatOpenT0 = t0;
}

/** Depuis le dernier `perfMarkStart("chat_open")` — étapes du clic → fil. */
export function perfChatOpenLap(label: string): void {
  if (!__DEV__ || chatOpenT0 == null) return;
  // eslint-disable-next-line no-console
  console.log(`[perf] chat_open→${label}: ${Date.now() - chatOpenT0}ms`);
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
  if (name === "chat_open") chatOpenT0 = null;
  return ms;
}

/** Derniers échantillons (debug / futur export). */
export function getPerfSamples() {
  return [...samples];
}
