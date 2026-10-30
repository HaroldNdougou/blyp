export type BlypActionFlashEvent = {
  id: string;
  message: string;
  durationMs: number;
};

type Listener = (event: BlypActionFlashEvent | null) => void;

const DEFAULT_DURATION_MS = 2800;

let current: BlypActionFlashEvent | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(current);
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function subscribeBlypActionFlash(cb: Listener): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}

export function dismissBlypActionFlash() {
  clearHideTimer();
  current = null;
  emit();
}

/** Pastille succès non bloquante (style « Paiement envoyé »). Préférer à `blypAlert` pour les actions réussies ; garder `blypAlert` pour erreurs et confirmations. */
export function showBlypActionFlash(
  message: string,
  options?: { durationMs?: number },
) {
  clearHideTimer();
  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  current = {
    id,
    message,
    durationMs,
  };
  emit();
  hideTimer = setTimeout(() => {
    if (current?.id === id) {
      current = null;
      emit();
    }
    hideTimer = null;
  }, durationMs);
}

export function getCurrentBlypActionFlash(): BlypActionFlashEvent | null {
  return current;
}
