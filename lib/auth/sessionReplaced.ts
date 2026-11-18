import { isSessionReplacedError } from "@/lib/api/errors";

type SessionReplacedListener = () => void;

const listeners = new Set<SessionReplacedListener>();
let pending = false;

export function subscribeSessionReplaced(
  listener: SessionReplacedListener,
): () => void {
  listeners.add(listener);
  if (pending) {
    pending = false;
    listener();
  }
  return () => listeners.delete(listener);
}

export function emitSessionReplaced() {
  if (listeners.size === 0) {
    pending = true;
    return;
  }
  for (const l of listeners) l();
}

export function emitSessionReplacedIfNeeded(e: unknown) {
  if (isSessionReplacedError(e)) emitSessionReplaced();
}
