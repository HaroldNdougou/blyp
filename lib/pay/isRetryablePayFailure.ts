import { ApiError, isApiNetworkFailure } from "@/lib/api/errors";

/** Aligné `BlypShellNetwork.isRetryablePayFailure` — retry file, pas rollback métier. */
export function isRetryablePayFailure(e: unknown): boolean {
  if (isApiNetworkFailure(e)) return true;
  if (e instanceof ApiError) {
    if (e.status === 429) return true;
    if (e.status >= 500) return true;
    if (e.status === 408) return true;
    if (e.status === 0) return true;
  }
  const msg = String(
    e instanceof Error ? e.message : typeof e === "string" ? e : "",
  )
    .trim()
    .toLowerCase();
  if (!msg || msg === "network") return true;
  return false;
}
