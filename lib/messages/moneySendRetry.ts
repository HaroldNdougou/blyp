import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";

/** Échec réseau / serveur — bulle conservée, retry au reconnect. */
export function isRetryableMoneySendError(e: unknown): boolean {
  if (isTransactionPinInvalidError(e)) return false;
  if (!(e instanceof ApiError)) return true;
  if (e.status === 0) return true;
  if (e.status >= 500) return true;
  return false;
}
