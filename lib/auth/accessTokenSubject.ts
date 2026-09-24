/** `sub` JWT (userId interne) — pour aligner mes messages, sans vérif crypto. */
export function accessTokenSubject(token: string | null | undefined): string | null {
  if (!token) return null;
  const seg = token.split(".")[1];
  if (!seg) return null;
  try {
    const padded =
      seg.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (seg.length % 4)) % 4);
    const json = JSON.parse(globalThis.atob(padded)) as { sub?: unknown };
    return typeof json.sub === "string" && json.sub.length > 0 ? json.sub : null;
  } catch {
    return null;
  }
}
