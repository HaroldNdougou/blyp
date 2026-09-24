/**
 * Résout le nom affiché d’un accountId BLE — cache d’abord, réseau après.
 * Ne bloque jamais le captage : à appeler en fire-and-forget / après paint.
 */
import {
  getPeerDisplayNameCached,
  hydratePeerDisplayName,
  rememberPeerDisplayName,
} from "@/lib/peers/displayNameCache";

const inflight = new Map<string, Promise<string | null>>();

export async function resolvePeerDisplayName(
  accountId: string,
  token: string | null | undefined,
): Promise<string | null> {
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  if (!id.startsWith("BLYP-")) return null;

  const ram = getPeerDisplayNameCached(id);
  if (ram) return ram;

  const local = await hydratePeerDisplayName(id);
  if (local) return local;

  const t = String(token ?? "").trim();
  if (!t) return null;

  const existing = inflight.get(id);
  if (existing) return existing;

  const job = (async () => {
    try {
      const { lookupAccountPublic } = await import("@/lib/api/client");
      const res = await lookupAccountPublic(t, id);
      const name = String(res?.displayName ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 48);
      if (name.length < 2) return null;
      rememberPeerDisplayName(id, name);
      return name;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, job);
  return job;
}
