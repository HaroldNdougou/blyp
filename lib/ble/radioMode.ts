/**
 * Un seul rôle radio à la fois : scan (client) XOR broadcast (taxi).
 */
type Listener = (broadcasting: boolean) => void;

let broadcasting = false;
const listeners = new Set<Listener>();

export function isBleBroadcasting(): boolean {
  return broadcasting;
}

export function subscribeBleBroadcasting(listener: Listener): () => void {
  listeners.add(listener);
  listener(broadcasting);
  return () => {
    listeners.delete(listener);
  };
}

export function setBleBroadcasting(active: boolean): void {
  if (broadcasting === active) return;
  broadcasting = active;
  listeners.forEach((l) => l(active));
}
