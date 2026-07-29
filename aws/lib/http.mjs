const JSON_HEADERS = {
  "Content-Type": "application/json",
};

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

export function ok(body) {
  return jsonResponse(200, body);
}

export function badRequest(message, extra = {}) {
  return jsonResponse(400, { error: message, ...extra });
}

export function unauthorized(message = "Non autorisé") {
  return jsonResponse(401, { error: message });
}

export function forbidden(message) {
  return jsonResponse(403, { error: message });
}

export function notFound(message = "Introuvable") {
  return jsonResponse(404, { error: message });
}

export function conflict(message, extra = {}) {
  return jsonResponse(409, { error: message, ...extra });
}

export function accepted(body) {
  return jsonResponse(202, body);
}

export function tooManyRequests(message, extra = {}) {
  return jsonResponse(429, { error: message, ...extra });
}

export function badGateway(message) {
  return jsonResponse(502, { error: message });
}

export function serviceUnavailable(message) {
  return jsonResponse(503, { error: message });
}

export function serverError(message = "Erreur serveur", extra = {}) {
  return jsonResponse(500, { error: message, ...extra });
}

export function parseJsonBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

export function getBearerToken(event) {
  const h = event?.headers?.authorization ?? event?.headers?.Authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

/** HTTP API avec stage dans l'URL (`/dev/health`) → `/health`. */
export function normalizeApiPath(event) {
  let path = event?.rawPath ?? event?.path ?? "/";
  const stage = event?.requestContext?.stage ?? process.env.STAGE;
  if (stage && stage !== "$default") {
    const prefix = `/${stage}`;
    if (path === prefix) path = "/";
    else if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  }
  return path;
}

export function getIdempotencyKey(event) {
  const h = event?.headers ?? {};
  const raw = h["idempotency-key"] ?? h["Idempotency-Key"] ?? "";
  const s = String(raw).trim();
  if (!s || s.length > 128) return null;
  return s;
}

export function parseRawBody(event) {
  if (!event?.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64");
  }
  return Buffer.from(event.body, "utf8");
}
