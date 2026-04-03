export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Présent si l’API renvoie 429 avec `retryAfterSeconds` (ex. renvoi SMS trop tôt). */
  retryAfterSeconds?: number;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    if (typeof body === "object" && body !== null && "retryAfterSeconds" in body) {
      const n = Number((body as { retryAfterSeconds: unknown }).retryAfterSeconds);
      if (Number.isFinite(n) && n > 0) {
        this.retryAfterSeconds = Math.min(3600, Math.ceil(n));
      }
    }
  }
}
