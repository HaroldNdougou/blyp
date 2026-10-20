import { peerAvatarUrl } from "@/lib/peers/peerAvatarUrl";

export function resolvePeerAvatarUri(opts: {
  remoteUrl?: string | null;
  localUri?: string | null;
  phone?: string | null;
}): string | null {
  const remote = String(opts.remoteUrl ?? "").trim();
  if (remote) return remote;
  const local = String(opts.localUri ?? "").trim();
  if (local) return local;
  return peerAvatarUrl(opts.phone);
}
