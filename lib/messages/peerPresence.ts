/** Fenêtre pendant laquelle un heartbeat pair compte comme « en ligne ». */
export const PEER_PRESENCE_TTL_MS = 45_000;

export function isPresenceAtOnline(iso: string | null | undefined): boolean {
  const s = String(iso ?? "").trim();
  if (!s) return false;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < PEER_PRESENCE_TTL_MS;
}
