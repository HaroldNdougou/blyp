import {
  accepted,
  badRequest,
  conflict,
  forbidden,
  getIdempotencyKey,
  normalizeApiPath,
  notFound,
  ok,
  parseJsonBody,
  serverError,
  serviceUnavailable,
  unauthorized,
} from "../../lib/http.mjs";
import { verifyAccessToken } from "../../lib/jwt.mjs";
import { verifyTransactionPin, getTransactionPinPepper } from "../../lib/pin.mjs";
import {
  getPawapayConfig,
  pawapayInitiateDeposit,
  pawapayGetDepositStatus,
  digitsForPawapayPayer,
  inferCameroonMomoProvider,
  normalizeMmProvider,
} from "../../lib/pawapayClient.mjs";
import {
  createPendingDepositIntent,
  depositIntentToStatusResponse,
  depositLimits,
  executePayment,
  executeSyncDeposit,
  finalizePawapayDeposit,
  failPawapayDeposit,
  getDepositByIdempotencyKey,
  getDepositIntent,
  isValidTxAmount,
  MAX_TX_AMOUNT_FCFA,
  isAsyncDepositMode,
  linkPawapayDeposit,
  listTransactions,
  updateDepositIntent,
} from "../../lib/wallet.mjs";
import { getUserBalance, getUserProfile } from "../../lib/user.mjs";
import { randomUUID } from "node:crypto";

async function requireUserId(event) {
  const token = event.headers?.authorization ?? event.headers?.Authorization;
  if (!token?.startsWith("Bearer ")) return { error: unauthorized() };
  try {
    const userId = await verifyAccessToken(token.slice(7).trim());
    return { userId };
  } catch {
    return { error: unauthorized("Session invalide") };
  }
}

async function syncRemotePawapayStatus(intent) {
  if (!intent?.pawapayDepositId || !getPawapayConfig().configured) {
    return intent;
  }
  const { httpStatus, json } = await pawapayGetDepositStatus(intent.pawapayDepositId);
  if (httpStatus === 0) return intent;

  const topStatus = String(json?.status || "").toUpperCase();
  const dataStatus = String(json?.data?.status || "").toUpperCase();

  if (topStatus === "FOUND") {
    if (dataStatus === "COMPLETED") {
      await finalizePawapayDeposit(intent.pawapayDepositId);
    } else if (dataStatus === "FAILED") {
      const fr = json?.data?.failureReason;
      const msg = fr?.failureMessage || fr?.failureCode || "Dépôt refusé ou échoué";
      await failPawapayDeposit(intent.pawapayDepositId, msg);
    }
  }

  return getDepositIntent(intent.userId, intent.depositIntentId);
}

async function handleDeposit(userId, event, body) {
  const { min, max } = depositLimits();
  const amount = parseInt(String(body?.amount), 10);
  const idempotencyKey = getIdempotencyKey(event);

  if (!Number.isFinite(amount) || amount < min || amount > max) {
    return badRequest(`Montant invalide (${min}–${max} FCFA)`);
  }

  const profile = await getUserProfile(userId);
  if (!profile) return notFound("Utilisateur introuvable");

  if (idempotencyKey) {
    const existing = await getDepositByIdempotencyKey(userId, idempotencyKey);
    if (existing) {
      const balanceFcfa = await getUserBalance(userId);
      const payload = depositIntentToStatusResponse(existing, balanceFcfa);
      if (payload.status === "failed") {
        return conflict(
          "Ce rechargement a échoué. Changez le montant ou réessayez plus tard.",
          { depositIntentId: existing.depositIntentId, status: "failed" },
        );
      }
      return ok(payload);
    }
  }

  if (!isAsyncDepositMode()) {
    const { intent, balanceFcfa } = await executeSyncDeposit(
      userId,
      amount,
      idempotencyKey,
    );
    return ok(depositIntentToStatusResponse(intent, balanceFcfa));
  }

  if (!getPawapayConfig().configured) {
    return serviceUnavailable(
      "PawaPay non configuré : définissez PAWAPAY_API_TOKEN sur la Lambda wallet.",
    );
  }

  const phoneDigits = digitsForPawapayPayer(profile.phone, body?.payerPhone);
  if (!phoneDigits) {
    return badRequest(
      "Numéro Mobile Money invalide. Utilisez 9 chiffres (6XXXXXXXX) ou 237…",
    );
  }
  const provider =
    normalizeMmProvider(body?.mmProvider) ||
    inferCameroonMomoProvider(phoneDigits);

  const pawapayDepositId = randomUUID();
  const depositIntentId = await createPendingDepositIntent(
    userId,
    amount,
    idempotencyKey,
    pawapayDepositId,
  );
  await linkPawapayDeposit(pawapayDepositId, userId, depositIntentId);

  const { currency } = getPawapayConfig();
  const pawa = await pawapayInitiateDeposit({
    depositId: pawapayDepositId,
    amountFcfa: amount,
    currency,
    phoneDigits,
    provider,
    clientReferenceId: depositIntentId,
  });

  if (pawa.error || pawa.httpStatus === 0) {
    await updateDepositIntent(depositIntentId, userId, {
      status: "FAILED",
      failureReason: `Réseau PawaPay : ${pawa.error || "erreur"}`,
      providerRef: "pawapay:network_error",
    });
    return serviceUnavailable(
      pawa.error || "Impossible de joindre PawaPay. Réessayez dans un instant.",
      { depositIntentId },
    );
  }

  const st = String(pawa.json?.status || "").toUpperCase();
  if (st === "REJECTED") {
    const fr = pawa.json?.failureReason;
    const msg = fr?.failureMessage || fr?.failureCode || "Dépôt refusé par PawaPay";
    await updateDepositIntent(depositIntentId, userId, {
      status: "FAILED",
      failureReason: msg.slice(0, 500),
      providerRef: "pawapay:rejected",
    });
    return badRequest(msg, { depositIntentId });
  }

  if (st === "ACCEPTED" || st === "DUPLICATE_IGNORED") {
    await updateDepositIntent(depositIntentId, userId, {
      providerRef: `pawapay:${st}`,
    });
    return accepted({
      status: "pending_provider",
      depositIntentId,
      pawapayDepositId,
      message:
        "Validez le paiement sur votre téléphone (Mobile Money).",
    });
  }

  await updateDepositIntent(depositIntentId, userId, {
    status: "FAILED",
    failureReason: `Réponse PawaPay inattendue : ${st || "?"}`,
    providerRef: "pawapay:unexpected",
  });
  return serverError("Réponse PawaPay inattendue après initiation.", {
    depositIntentId,
  });
}

async function handleDepositStatus(userId, depositIntentId) {
  if (!depositIntentId?.trim()) {
    return badRequest("Identifiant invalide");
  }
  let intent = await getDepositIntent(userId, depositIntentId.trim());
  if (!intent) return notFound("Dépôt introuvable");

  if (intent.status === "PENDING_PROVIDER") {
    intent = await syncRemotePawapayStatus(intent);
  }

  const balanceFcfa = await getUserBalance(userId);
  return ok(depositIntentToStatusResponse(intent, balanceFcfa));
}

async function handlePay(userId, body, event) {
  const amount = parseInt(String(body?.amount), 10);
  const recipientName = body?.recipientName || "Bénéficiaire";
  const recipientPhone = body?.recipientPhone ?? null;
  const transactionPin = String(body?.transactionPin ?? "").replace(/\D/g, "");
  const idempotencyKey = getIdempotencyKey(event);

  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest("Montant invalide");
  }
  if (!isValidTxAmount(amount)) {
    return badRequest(`Montant invalide (max ${MAX_TX_AMOUNT_FCFA.toLocaleString("fr-FR")} FCFA)`);
  }
  if (transactionPin.length !== 4) {
    return badRequest("Code PIN de transaction requis (4 chiffres)");
  }

  const profile = await getUserProfile(userId);
  if (!profile) return notFound("Utilisateur introuvable");
  if (!profile.transactionPinHash) {
    return forbidden("Complétez votre inscription (code PIN) pour payer");
  }
  if (
    !verifyTransactionPin(
      transactionPin,
      profile.transactionPinHash,
      getTransactionPinPepper(),
    )
  ) {
    return badRequest("Code PIN incorrect");
  }

  const result = await executePayment(
    userId,
    amount,
    recipientName,
    recipientPhone,
    idempotencyKey,
  );

  if (result.error === "INSUFFICIENT_BALANCE") {
    return badRequest("Solde insuffisant");
  }
  if (result.error === "AMOUNT_INVALID") {
    return badRequest(`Montant invalide (max ${MAX_TX_AMOUNT_FCFA.toLocaleString("fr-FR")} FCFA)`);
  }

  return ok({
    balanceFcfa: result.balanceFcfa,
    transactionId: result.transactionId ?? null,
    reference: result.reference ?? null,
  });
}

async function handleTransactions(userId, event) {
  const q = event.queryStringParameters ?? {};
  const since = q.since ? String(q.since) : null;
  const items = await listTransactions(userId, { since });
  const cursor =
    items.length > 0
      ? items.reduce((max, t) => (t.createdAt > max ? t.createdAt : max), items[0].createdAt)
      : since;
  return ok({ items, cursor: cursor ?? null, delta: Boolean(since) });
}

export async function handler(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const path = normalizeApiPath(event);

  try {
    if (method === "POST" && path === "/wallet/deposit") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleDeposit(auth.userId, event, body);
    }

    const depositMatch = path.match(/^\/wallet\/deposits\/([^/]+)$/);
    if (method === "GET" && depositMatch) {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleDepositStatus(auth.userId, depositMatch[1]);
    }

    if (method === "POST" && path === "/payments/pay") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handlePay(auth.userId, body, event);
    }

    if (method === "GET" && path === "/transactions") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleTransactions(auth.userId, event);
    }

    return badRequest("Route introuvable");
  } catch (err) {
    console.error("[wallet]", path, err);
    return serverError(
      process.env.STAGE === "prod"
        ? "Erreur serveur"
        : err instanceof Error
          ? err.message
          : "Erreur serveur",
    );
  }
}
