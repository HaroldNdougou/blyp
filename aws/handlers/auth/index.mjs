import {
  badGateway,
  badRequest,
  getBearerToken,
  normalizeApiPath,
  ok,
  parseJsonBody,
  serverError,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from "../../lib/http.mjs";
import { signAccessToken, verifyAccessToken } from "../../lib/jwt.mjs";
import {
  generateOtpCode,
  hashOtp,
  otpVerifyCacheKey,
} from "../../lib/otp.mjs";
import { normalizeCameroonPhone } from "../../lib/phone.mjs";
import {
  getTransactionPinPepper,
  hashTransactionPin,
} from "../../lib/pin.mjs";
import { deliverOtpSms } from "../../lib/sms.mjs";
import {
  clearOtpCooldown,
  deleteOtpChallenge,
  findOrCreateUserByPhoneSafe,
  getOtpChallenge,
  getOtpCooldown,
  getOtpVerifyCache,
  getUserApiPayload,
  getUserProfile,
  logOtpSend,
  putOtpChallenge,
  putOtpVerifyCache,
  setOtpCooldown,
  setTransactionPin,
  updateProfileNames,
} from "../../lib/user.mjs";

function isItemActive(item) {
  if (!item?.expiresAt) return true;
  return item.expiresAt > Math.floor(Date.now() / 1000);
}

async function requireUserId(event) {
  const token = getBearerToken(event);
  if (!token) return { error: unauthorized() };
  try {
    const userId = await verifyAccessToken(token);
    return { userId };
  } catch {
    return { error: unauthorized("Session invalide") };
  }
}

async function handleRequestOtp(body) {
  const phone = normalizeCameroonPhone(body?.phone);
  if (!phone) {
    return badRequest("Numéro invalide (9 chiffres commençant par 6)");
  }

  const cooldown = await getOtpCooldown(phone);
  if (cooldown && isItemActive(cooldown)) {
    const retryAfterSeconds = Math.max(
      1,
      cooldown.expiresAt - Math.floor(Date.now() / 1000),
    );
    return tooManyRequests(
      "Un nouveau code ne peut être envoyé que toutes les 60 secondes. Réessayez dans un instant.",
      { retryAfterSeconds },
    );
  }

  const code = generateOtpCode();
  const codeHash = hashOtp(phone, code);
  await putOtpChallenge(phone, codeHash);

  const sent = await deliverOtpSms(phone, code);
  if (!sent.ok) {
    await deleteOtpChallenge(phone);
    await clearOtpCooldown(phone);
    if (sent.reason === "sms_not_configured") {
      return serviceUnavailable(
        "Envoi SMS non configuré côté serveur. Configure OBIT_SMS_* ou un autre fournisseur SMS sur la Lambda auth.",
      );
    }
    return badGateway(
      "Impossible d’envoyer le SMS pour le moment. Réessaie dans un instant.",
    );
  }

  await setOtpCooldown(phone);
  try {
    await logOtpSend(phone);
  } catch (err) {
    console.error("[auth/request-otp] logOtpSend", err);
  }

  return ok({ ok: true });
}

async function handleVerifyOtp(body) {
  const phone = normalizeCameroonPhone(body?.phone);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) {
    return badRequest("Téléphone ou code invalide");
  }

  const cacheKey = otpVerifyCacheKey(phone, code);
  const cached = await getOtpVerifyCache(cacheKey);
  if (cached) return ok(cached);

  const challenge = await getOtpChallenge(phone);
  const expectedHash = hashOtp(phone, code);
  if (!challenge || !isItemActive(challenge)) {
    return badRequest("Code incorrect ou expiré");
  }
  if (challenge.codeHash !== expectedHash) {
    return badRequest("Code incorrect ou expiré");
  }

  await deleteOtpChallenge(phone);
  const { userId, user, isNewAccount } = await findOrCreateUserByPhoneSafe(phone);
  const token = await signAccessToken(userId);
  const payload = { token, user, isNewAccount };
  await putOtpVerifyCache(cacheKey, payload);
  return ok(payload);
}

async function handleSetPin(userId, body) {
  const pin = String(body?.pin ?? "").replace(/\D/g, "");
  if (pin.length !== 4) {
    return badRequest("Le code PIN doit comporter 4 chiffres");
  }

  const profile = await getUserProfile(userId);
  if (!profile) return unauthorized("Utilisateur introuvable");
  if (profile.transactionPinHash) {
    return badRequest("Code PIN déjà défini");
  }

  let hash;
  try {
    hash = hashTransactionPin(pin, getTransactionPinPepper());
  } catch (err) {
    console.error("[onboarding/pin]", err);
    return serverError("Configuration serveur (PIN) invalide");
  }

  try {
    await setTransactionPin(userId, hash);
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      return badRequest("Code PIN déjà défini");
    }
    throw err;
  }

  const user = await getUserApiPayload(userId);
  return ok({ user });
}

async function handleSetProfile(userId, body) {
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  if (firstName.length < 2 || firstName.length > 80) {
    return badRequest("Prénom invalide (2 à 80 caractères)");
  }
  if (lastName.length < 2 || lastName.length > 80) {
    return badRequest("Nom invalide (2 à 80 caractères)");
  }
  const nameRe = /^[a-zA-ZÀ-ÿ\s'-]+$/;
  if (!nameRe.test(firstName) || !nameRe.test(lastName)) {
    return badRequest(
      "Prénom ou nom : lettres, espaces, tirets et apostrophes uniquement",
    );
  }

  const profile = await getUserProfile(userId);
  if (!profile) return unauthorized("Utilisateur introuvable");
  if (!profile.transactionPinHash) {
    return badRequest("Définissez d’abord votre code PIN de transaction");
  }

  await updateProfileNames(userId, firstName, lastName);
  const user = await getUserApiPayload(userId);
  return ok({ user });
}

async function handleMe(userId) {
  const user = await getUserApiPayload(userId);
  if (!user) return unauthorized("Utilisateur introuvable");
  return ok(user);
}

export async function handler(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const path = normalizeApiPath(event);

  try {
    if (method === "POST" && path === "/auth/request-otp") {
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleRequestOtp(body);
    }

    if (method === "POST" && path === "/auth/verify-otp") {
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleVerifyOtp(body);
    }

    if (method === "POST" && path === "/auth/onboarding/transaction-pin") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleSetPin(auth.userId, body);
    }

    if (method === "POST" && path === "/auth/onboarding/profile") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleSetProfile(auth.userId, body);
    }

    if (method === "GET" && path === "/me") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleMe(auth.userId);
    }

    return badRequest("Route introuvable");
  } catch (err) {
    console.error("[auth]", path, err);
    return serverError(
      process.env.STAGE === "prod"
        ? "Erreur serveur"
        : err instanceof Error
          ? err.message
          : "Erreur serveur",
    );
  }
}
