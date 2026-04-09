/** Code métier renvoyé par l’API (corps JSON), ex. échec PIN transaction. */
export const API_ERROR_TRANSACTION_PIN_INVALID = "TRANSACTION_PIN_INVALID";

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Présent si le corps JSON contient `code` (erreurs métier typées). */
  code?: string;
  /** Présent si l’API renvoie 429 avec `retryAfterSeconds` (ex. renvoi SMS trop tôt). */
  retryAfterSeconds?: number;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    if (typeof body === "object" && body !== null) {
      const o = body as Record<string, unknown>;
      if (typeof o.code === "string" && o.code.trim()) {
        this.code = o.code.trim();
      }
      if ("retryAfterSeconds" in o) {
        const n = Number(o.retryAfterSeconds);
        if (Number.isFinite(n) && n > 0) {
          this.retryAfterSeconds = Math.min(3600, Math.ceil(n));
        }
      }
    }
  }
}

/** Indique un PIN de transaction refusé (à distinguer d’un solde insuffisant, etc.). */
export function isTransactionPinInvalidError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code === API_ERROR_TRANSACTION_PIN_INVALID) return true;
  const m = e.message.toLowerCase();
  return (
    m.includes("pin incorrect") ||
    m.includes("code pin incorrect") ||
    (m.includes("transaction pin") && m.includes("invalid"))
  );
}
