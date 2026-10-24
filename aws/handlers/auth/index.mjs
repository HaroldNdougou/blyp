import {
  badGateway,
  badRequest,
  getBearerToken,
  normalizeApiPath,
  notFound,
  ok,
  parseJsonBody,
  serverError,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from "../../lib/http.mjs";
import { verifyAccessToken } from "../../lib/jwt.mjs";
import {
  hashOtp,
  otpVerifyCacheKey,
  TEMP_DEV_OTP_CODE,
} from "../../lib/otp.mjs";
import { normalizeCameroonPhone } from "../../lib/phone.mjs";
import {
  getTransactionPinPepper,
  hashTransactionPin,
} from "../../lib/pin.mjs";
import {
  issueAuthSession,
  rotateAuthSession,
} from "../../lib/refreshTokens.mjs";
import { deliverOtpSms } from "../../lib/sms.mjs";
import {
  deleteOtpChallenge,
  enableMerchant,
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
  touchAvatarUpdated,
} from "../../lib/user.mjs";
import {
  presignAvatarUpload,
  isAvatarKeyForPhone,
} from "../../lib/avatar.mjs";
import {
  presignKycDocumentUpload,
  submitKycApplication,
} from "../../lib/kyc.mjs";
import {
  confirmVaultDocument,
  deleteVaultDocument,
  listVaultDocuments,
  presignVaultDownload,
  presignVaultUpload,
} from "../../lib/vault.mjs";
import {
  createCommerce,
  getPublicAccountLabel,
  listCommercesForUser,
  setActiveContext,
  updateCommerceCategory,
} from "../../lib/commerce.mjs";
import {
  getSoaCarDayReport,
  getSoaCarTripByAccountId,
  getSoaCarTripForOwner,
  resetSoaCarTrip,
} from "../../lib/soaCarTrip.mjs";
import {
  deleteDeviceToken,
  upsertDeviceToken,
} from "../../lib/devices.mjs";

function trimStr(v) {
  return String(v ?? "").trim();
}

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

  /** TEMP : challenge toujours sur 1234 pour pouvoir se connecter sans SMS. */
  const code = TEMP_DEV_OTP_CODE;
  const codeHash = hashOtp(phone, code);
  await putOtpChallenge(phone, codeHash);
  await setOtpCooldown(phone);

  /** SMS hors chemin critique — ne pas bloquer la réponse HTTP (Obit/Orange lent). */
  void deliverOtpSms(phone, code).then((sent) => {
    if (!sent.ok) {
      console.warn(
        "[auth/request-otp] SMS échoué — TEMP_DEV_OTP_CODE actif, challenge conservé",
        sent.reason,
      );
    }
  });
  void logOtpSend(phone).catch((err) => {
    console.error("[auth/request-otp] logOtpSend", err);
  });

  return ok({ ok: true });
}

async function handleVerifyOtp(body) {
  const phone = normalizeCameroonPhone(body?.phone);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  const isTempDevOtp = code === TEMP_DEV_OTP_CODE;
  if (!phone || (!isTempDevOtp && code.length !== 6) || (isTempDevOtp && code.length !== 4)) {
    return badRequest("Téléphone ou code invalide");
  }

  const cacheKey = otpVerifyCacheKey(phone, code);
  const cached = await getOtpVerifyCache(cacheKey);
  if (cached) return ok(cached);

  let challenge = await getOtpChallenge(phone);
  /** Course : l’écran code s’ouvre avant la fin de `request-otp` / réplique Dynamo. */
  if (!challenge || !isItemActive(challenge)) {
    await new Promise((r) => setTimeout(r, 200));
    challenge = await getOtpChallenge(phone);
  }
  const expectedHash = hashOtp(phone, code);
  if (!challenge || !isItemActive(challenge)) {
    return badRequest("Code incorrect ou expiré");
  }
  if (challenge.codeHash !== expectedHash) {
    return badRequest("Code incorrect ou expiré");
  }

  await deleteOtpChallenge(phone);
  const { userId, user, isNewAccount } = await findOrCreateUserByPhoneSafe(phone);
  const session = await issueAuthSession(userId);
  const payload = {
    token: session.token,
    refreshToken: session.refreshToken,
    user,
    isNewAccount,
  };
  await putOtpVerifyCache(cacheKey, payload);
  return ok(payload);
}

async function handleRefresh(body) {
  const refreshToken = String(body?.refreshToken ?? "").trim();
  if (!refreshToken) {
    return unauthorized("Session expirée. Reconnectez-vous.");
  }
  const session = await rotateAuthSession(refreshToken);
  if (!session) {
    return unauthorized("Session expirée. Reconnectez-vous.");
  }
  return ok({
    token: session.token,
    refreshToken: session.refreshToken,
  });
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

async function handleAvatarPresign(userId, body) {
  const profile = await getUserProfile(userId);
  if (!profile?.phone) return unauthorized("Utilisateur introuvable");
  const contentType = String(body?.contentType ?? "image/jpeg").trim();
  const signed = await presignAvatarUpload(userId, profile.phone, contentType);
  if (signed.error === "ASSETS_UNAVAILABLE") {
    return serviceUnavailable("Photos indisponibles");
  }
  if (signed.error) return badRequest("Requête invalide");
  return ok(signed);
}

async function handleKycPresign(userId, body) {
  const docType = String(body?.docType ?? "").trim();
  const side = String(body?.side ?? "").trim();
  const contentType = String(body?.contentType ?? "image/jpeg").trim();
  const signed = await presignKycDocumentUpload(
    userId,
    docType,
    side,
    contentType,
  );
  if (signed.error === "KYC_STORAGE_UNAVAILABLE") {
    return serviceUnavailable("Vérification indisponible");
  }
  if (signed.error) return badRequest("Requête invalide");
  return ok(signed);
}

async function handleKycSubmit(userId, body) {
  const profile = await getUserProfile(userId);
  if (!profile) return unauthorized("Utilisateur introuvable");
  if (profile.kycStatus === "pending") {
    return badRequest("Vérification déjà en cours");
  }
  if (profile.kycStatus === "approved") {
    const user = await getUserApiPayload(userId);
    return ok({ user });
  }
  const result = await submitKycApplication(userId, body);
  if (result.error === "BACK_REQUIRED") {
    return badRequest("Photo verso de la CNI requise");
  }
  if (result.error === "INVALID_KEY" || result.error === "INVALID_DOC") {
    return badRequest("Documents invalides");
  }
  const user = await getUserApiPayload(userId);
  return ok({ user });
}

async function handleAvatarConfirm(userId, body) {
  const profile = await getUserProfile(userId);
  if (!profile?.phone) return unauthorized("Utilisateur introuvable");
  const key = String(body?.key ?? "").trim();
  const phoneNine = String(profile.phone ?? "").replace(/\D/g, "").slice(-9);
  if (!isAvatarKeyForPhone(key, phoneNine)) {
    return badRequest("Clé avatar invalide");
  }
  await touchAvatarUpdated(userId);
  const user = await getUserApiPayload(userId);
  return ok({ user });
}

async function handleEnableMerchant(userId) {
  const profile = await getUserProfile(userId);
  if (!profile) return unauthorized("Utilisateur introuvable");
  if (!profile.transactionPinHash) {
    return badRequest("Terminez l’inscription (PIN) avant de devenir commerçant");
  }
  if (!trimStr(profile.firstName) || !trimStr(profile.lastName)) {
    return badRequest("Terminez votre profil (prénom / nom) avant de devenir commerçant");
  }
  const user = await enableMerchant(userId);
  return ok({ user });
}

async function handleCreateCommerce(userId, body) {
  const result = await createCommerce(userId, body);
  if (result.error === "USER_NOT_FOUND") return unauthorized("Utilisateur introuvable");
  if (result.error === "ONBOARDING_REQUIRED") {
    return badRequest("Terminez l’inscription avant de créer un commerce");
  }
  if (result.error === "NAME_INVALID") {
    return badRequest("Nom du commerce trop court");
  }
  if (result.error === "PHONE_INVALID") {
    return badRequest("Téléphone invalide");
  }
  if (result.error === "LIMIT") {
    return badRequest("Limite de commerces atteinte");
  }
  if (result.error) return serverError("Création commerce impossible");
  const user = await getUserApiPayload(userId);
  return ok({ commerce: result.commerce, user });
}

async function handleListCommerces(userId) {
  const commerces = await listCommercesForUser(userId);
  return ok({ items: commerces });
}

async function handlePatchCommerce(userId, commerceIdRaw, body) {
  const commerceId = String(commerceIdRaw ?? "").trim();
  if (!commerceId) return badRequest("commerceId requis");
  if (body?.category == null) {
    return badRequest("category requis");
  }
  const result = await updateCommerceCategory(
    userId,
    commerceId,
    body.category,
  );
  if (result.error === "NOT_FOUND") return notFound("Commerce introuvable");
  const user = await getUserApiPayload(userId);
  return ok({ commerce: result.commerce, user });
}

async function handleVaultList(userId) {
  const result = await listVaultDocuments(userId);
  if (result.error === "ACCOUNT_INVALID") return badRequest("Compte invalide");
  return ok(result);
}

async function handleVaultPresign(userId, body) {
  const result = await presignVaultUpload(userId, body);
  if (result.error === "VAULT_UNAVAILABLE") {
    return serviceUnavailable("Coffre indisponible");
  }
  if (result.error === "QUOTA_EXCEEDED") {
    return badRequest("Espace documents plein pour ce compte");
  }
  if (result.error === "SIZE_INVALID") {
    return badRequest("Fichier trop volumineux (max 25 Mo)");
  }
  if (result.error) return badRequest("Requête invalide");
  return ok(result);
}

async function handleVaultConfirm(userId, body) {
  const result = await confirmVaultDocument(userId, body);
  if (result.error === "QUOTA_EXCEEDED") {
    return badRequest("Espace documents plein pour ce compte");
  }
  if (result.error === "KEY_INVALID" || result.error === "INVALID_INPUT") {
    return badRequest("Document invalide");
  }
  if (result.error === "SIZE_INVALID") {
    return badRequest("Fichier trop volumineux (max 25 Mo)");
  }
  if (result.error) return badRequest("Enregistrement impossible");
  return ok(result);
}

async function handleVaultDownload(userId, docId) {
  const result = await presignVaultDownload(userId, docId);
  if (result.error === "NOT_FOUND") return notFound("Document introuvable");
  if (result.error === "VAULT_UNAVAILABLE") {
    return serviceUnavailable("Coffre indisponible");
  }
  return ok(result);
}

async function handleVaultDelete(userId, docId) {
  const result = await deleteVaultDocument(userId, docId);
  if (result.error === "NOT_FOUND") return notFound("Document introuvable");
  return ok({ ok: true });
}

async function handleSetContext(userId, body) {
  const result = await setActiveContext(userId, body);
  if (result.error === "TYPE_INVALID") return badRequest("Contexte invalide");
  if (result.error === "COMMERCE_REQUIRED") {
    return badRequest("commerceId requis");
  }
  if (result.error === "NOT_FOUND") return badRequest("Commerce introuvable");
  const user = await getUserApiPayload(userId);
  return ok({ user });
}

async function handleUpsertDeviceToken(userId, body) {
  const result = await upsertDeviceToken(userId, {
    token: body?.token,
    platform: body?.platform,
    deviceId: body?.deviceId,
  });
  if (result.error === "TOKEN_INVALID") {
    return badRequest("Jeton push invalide");
  }
  return ok({ ok: true });
}

async function handleDeleteDeviceToken(userId, body) {
  const result = await deleteDeviceToken(userId, {
    token: body?.token,
    deviceId: body?.deviceId,
  });
  if (result.error === "TOKEN_REQUIRED") {
    return badRequest("Jeton ou deviceId requis");
  }
  return ok({ ok: true });
}

async function handlePublicAccount(accountIdRaw) {
  const accountId = String(accountIdRaw ?? "")
    .trim()
    .toUpperCase();
  if (!accountId.startsWith("BLYP-") || accountId.length < 12) {
    return badRequest("accountId invalide");
  }
  const label = await getPublicAccountLabel(accountId);
  if (!label) return notFound("Compte introuvable");
  const displayName =
    label.displayName && String(label.displayName).trim().length >= 2
      ? String(label.displayName).trim().slice(0, 48)
      : null;
  if (!displayName) return notFound("Nom indisponible");
  return ok({
    accountId: label.accountId,
    displayName,
    kind: label.kind,
    category: label.category ?? null,
  });
}

async function handleSoaTripByAccount(accountIdRaw) {
  const accountId = String(accountIdRaw ?? "")
    .trim()
    .toUpperCase();
  if (!accountId.startsWith("BLYP-") || accountId.length < 12) {
    return badRequest("accountId invalide");
  }
  const result = await getSoaCarTripByAccountId(accountId);
  if (result.error === "NOT_FOUND") return notFound("Compte introuvable");
  if (result.error === "NOT_SOA_CAR") {
    return badRequest("Ce commerce n’est pas un car Soa");
  }
  return ok({ trip: result.trip });
}

async function handleSoaTripForOwner(userId, commerceIdRaw) {
  const commerceId = String(commerceIdRaw ?? "").trim();
  if (!commerceId) return badRequest("commerceId requis");
  const result = await getSoaCarTripForOwner(userId, commerceId);
  if (result.error === "NOT_FOUND") return notFound("Commerce introuvable");
  if (result.error === "NOT_SOA_CAR") {
    return badRequest("Ce commerce n’est pas un car Soa");
  }
  return ok({ trip: result.trip });
}

async function handleSoaTripReset(userId, commerceIdRaw) {
  const commerceId = String(commerceIdRaw ?? "").trim();
  if (!commerceId) return badRequest("commerceId requis");
  const result = await resetSoaCarTrip(userId, commerceId);
  if (result.error === "NOT_FOUND") return notFound("Commerce introuvable");
  if (result.error === "NOT_SOA_CAR") {
    return badRequest("Ce commerce n’est pas un car Soa");
  }
  return ok({ trip: result.trip });
}

async function handleSoaDayReport(userId, commerceIdRaw, dayKey) {
  const commerceId = String(commerceIdRaw ?? "").trim();
  if (!commerceId) return badRequest("commerceId requis");
  const result = await getSoaCarDayReport(userId, commerceId, dayKey);
  if (result.error === "NOT_FOUND") return notFound("Commerce introuvable");
  if (result.error === "NOT_SOA_CAR") {
    return badRequest("Ce commerce n’est pas un car Soa");
  }
  if (result.error === "DAY_INVALID") return badRequest("Date invalide");
  if (result.error === "COMMERCE_REQUIRED") {
    return badRequest("commerceId requis");
  }
  return ok(result);
}

export async function handler(event, context) {
  /** Ne pas attendre les promesses SMS en arrière-plan après la réponse. */
  if (context && typeof context.callbackWaitsForEmptyEventLoop === "boolean") {
    context.callbackWaitsForEmptyEventLoop = false;
  }

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

    if (method === "POST" && path === "/auth/refresh") {
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleRefresh(body);
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

    if (method === "POST" && path === "/me/avatar/presign") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleAvatarPresign(auth.userId, body);
    }

    if (method === "POST" && path === "/me/avatar/confirm") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleAvatarConfirm(auth.userId, body);
    }

    if (method === "POST" && path === "/kyc/presign") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleKycPresign(auth.userId, body);
    }

    if (method === "POST" && path === "/kyc/submit") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleKycSubmit(auth.userId, body);
    }

    if (method === "POST" && path === "/auth/merchant/enable") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleEnableMerchant(auth.userId);
    }

    if (method === "POST" && path === "/commerces") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleCreateCommerce(auth.userId, body);
    }

    if (method === "GET" && path === "/commerces") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleListCommerces(auth.userId);
    }

    const commercePatch = path.match(/^\/commerces\/([^/]+)$/);
    if (commercePatch && method === "PATCH") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handlePatchCommerce(
        auth.userId,
        decodeURIComponent(commercePatch[1]),
        body,
      );
    }

    if (method === "GET" && path === "/vault/documents") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleVaultList(auth.userId);
    }

    if (method === "POST" && path === "/vault/documents/presign") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleVaultPresign(auth.userId, body);
    }

    if (method === "POST" && path === "/vault/documents") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleVaultConfirm(auth.userId, body);
    }

    const vaultDoc = path.match(/^\/vault\/documents\/([^/]+)$/);
    if (vaultDoc) {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const id = decodeURIComponent(vaultDoc[1]);
      if (method === "GET") return await handleVaultDownload(auth.userId, id);
      if (method === "DELETE") return await handleVaultDelete(auth.userId, id);
    }

    if (method === "PUT" && path === "/me/context") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleSetContext(auth.userId, body);
    }

    const accountPublic = path.match(/^\/accounts\/([^/]+)\/public$/);
    if (method === "GET" && accountPublic) {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handlePublicAccount(decodeURIComponent(accountPublic[1]));
    }

    const accountSoaTrip = path.match(/^\/accounts\/([^/]+)\/soa-trip$/);
    if (method === "GET" && accountSoaTrip) {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      return await handleSoaTripByAccount(decodeURIComponent(accountSoaTrip[1]));
    }

    const commerceSoaDayReport = path.match(
      /^\/commerces\/([^/]+)\/soa-trip\/day-report$/,
    );
    if (method === "GET" && commerceSoaDayReport) {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const commerceId = decodeURIComponent(commerceSoaDayReport[1]);
      const qs = event.queryStringParameters ?? {};
      const day = String(qs.day ?? "").trim();
      return await handleSoaDayReport(auth.userId, commerceId, day);
    }

    const commerceSoaTrip = path.match(/^\/commerces\/([^/]+)\/soa-trip$/);
    if (commerceSoaTrip) {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const commerceId = decodeURIComponent(commerceSoaTrip[1]);
      if (method === "GET") {
        return await handleSoaTripForOwner(auth.userId, commerceId);
      }
      if (method === "POST") {
        return await handleSoaTripReset(auth.userId, commerceId);
      }
    }

    if (method === "PUT" && path === "/me/device-token") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event);
      if (body === null) return badRequest("Corps JSON invalide");
      return await handleUpsertDeviceToken(auth.userId, body);
    }

    if (method === "DELETE" && path === "/me/device-token") {
      const auth = await requireUserId(event);
      if (auth.error) return auth.error;
      const body = parseJsonBody(event) ?? {};
      return await handleDeleteDeviceToken(auth.userId, body);
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
