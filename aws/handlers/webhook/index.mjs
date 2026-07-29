import {
  badRequest,
  normalizeApiPath,
  ok,
  parseRawBody,
  serverError,
  serviceUnavailable,
  unauthorized,
} from "../../lib/http.mjs";
import {
  failPawapayDeposit,
  finalizePawapayDeposit,
  isAsyncDepositMode,
  verifyPawapayWebhookSignature,
} from "../../lib/wallet.mjs";

function notFoundWebhook() {
  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Dépôt introuvable" }),
  };
}

export async function handler(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const path = normalizeApiPath(event);

  if (method !== "POST" || path !== "/webhooks/pawapay/deposit") {
    return badRequest("Route introuvable");
  }

  if (!isAsyncDepositMode()) {
    return badRequest("Mode async désactivé");
  }

  const raw = parseRawBody(event);
  if (!raw.length) {
    return badRequest("Corps vide");
  }

  const sig =
    event.headers?.["x-pawapay-signature"] ??
    event.headers?.["X-Pawapay-Signature"];

  if (!verifyPawapayWebhookSignature(raw, sig)) {
    const mode = (process.env.PAWAPAY_WEBHOOK_VERIFY || "none").toLowerCase();
    if (mode === "hmac" && !(process.env.PAWAPAY_WEBHOOK_SECRET || "").trim()) {
      return serviceUnavailable("PAWAPAY_WEBHOOK_SECRET manquant");
    }
    return unauthorized("Signature invalide");
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return badRequest("JSON invalide");
  }

  const depositId = String(body?.depositId ?? "").trim();
  const status = String(body?.status || "").toUpperCase();
  if (!depositId) {
    return badRequest("depositId requis");
  }

  try {
    if (status === "PROCESSING") {
      return ok({ ok: true });
    }

    if (status === "FAILED") {
      const fr = body?.failureReason;
      const msg =
        fr?.failureMessage || fr?.failureCode || "Dépôt échoué (callback)";
      await failPawapayDeposit(depositId, msg);
      return ok({ ok: true });
    }

    if (status !== "COMPLETED") {
      return badRequest(`Statut callback non géré : ${status}`);
    }

    const result = await finalizePawapayDeposit(depositId);
    if (!result.ok && result.reason === "not_found") {
      return notFoundWebhook();
    }
    return ok({ ok: true });
  } catch (err) {
    console.error("[webhook/pawapay/deposit]", err);
    return serverError("Traitement impossible");
  }
}
