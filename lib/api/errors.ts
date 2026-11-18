/** Code métier renvoyé par l’API (corps JSON), ex. échec PIN transaction. */
export const API_ERROR_TRANSACTION_PIN_INVALID = "TRANSACTION_PIN_INVALID";
export const API_ERROR_PAYMENT_RECEIPT_ALREADY_ENCASHED =
  "PAYMENT_RECEIPT_ALREADY_ENCASHED";
export const API_ERROR_SESSION_REPLACED = "SESSION_REPLACED";

export class SessionReplaceCancelledError extends Error {
  constructor() {
    super("SESSION_REPLACE_CANCELLED");
    this.name = "SessionReplaceCancelledError";
  }
}

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

/** Plafond « sans code » atteint — repasser par le PIN, pas échec définitif. */
export function isSmallPayLimitPinRequiredError(e: unknown): boolean {
  if (!(e instanceof ApiError)) {
    if (typeof e !== "object" || e === null) return false;
    if ((e as { name?: string }).name !== "ApiError") return false;
  }
  const m = String((e as ApiError).message ?? "").toLowerCase();
  return (
    m.includes("plafond") &&
    (m.includes("sans code") ||
      m.includes("saisissez votre pin") ||
      m.includes("saisissez votre code"))
  );
}

/** Échec liaison / timeout / gateway — pas une erreur métier PIN ou solde. */
export function isApiNetworkFailure(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    (e.status === 0 ||
      e.status === 408 ||
      e.status === 502 ||
      e.status === 503 ||
      e.status === 504)
  );
}

/** Compte connecté ailleurs — une seule session active (style WhatsApp). */
export function isSessionReplacedError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code === API_ERROR_SESSION_REPLACED) return true;
  const m = e.message.toLowerCase();
  return m.includes("autre téléphone") || m.includes("another device");
}

function isApiErrorLike(e: unknown): e is ApiError {
  if (e instanceof ApiError) return true;
  if (typeof e !== "object" || e === null) return false;
  const o = e as { name?: unknown; status?: unknown; message?: unknown };
  return o.name === "ApiError" && typeof o.status === "number";
}

/** Message utilisateur depuis une erreur API / réseau (évite le générique si le corps JSON est lisible). */
export function getApiErrorMessage(e: unknown, fallback: string): string {
  if (isApiErrorLike(e)) {
    const msg = String(e.message ?? "").trim();
    if (msg) return msg;
  }
  if (e instanceof Error) {
    const msg = e.message.trim();
    if (msg) return msg;
  }
  return fallback;
}
