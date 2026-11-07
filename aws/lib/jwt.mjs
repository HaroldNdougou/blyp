import { SignJWT, jwtVerify } from "jose";

/**
 * Access court — le refresh (180 j) maintient la session type WhatsApp.
 * Surcharge possible : JWT_ACCESS_EXPIRY=15m|1h|7d
 */
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY?.trim() || "1h";

function getSecretKey() {
  const secret = process.env.JWT_SECRET?.trim() || "dev-insecure";
  return new TextEncoder().encode(secret);
}

/** `devicePublicKey` : clé appareil liée au jeton (preuve exigée sur les actions d’argent). */
export async function signAccessToken(userId, sessionFamilyId, devicePublicKey = null) {
  const fid = String(sessionFamilyId ?? "").trim();
  const dpk = String(devicePublicKey ?? "").trim();
  const claims = { typ: "access" };
  if (fid) claims.sfn = fid;
  if (dpk) claims.dpk = dpk;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRY)
    .sign(getSecretKey());
}

/** @returns {{ userId: string, sessionFamilyId: string | null, devicePublicKey: string | null }} */
export async function parseAccessToken(token) {
  const { payload } = await jwtVerify(token, getSecretKey());
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("INVALID_TOKEN");
  }
  const sfn = payload.sfn;
  const sessionFamilyId =
    typeof sfn === "string" && sfn.trim() ? sfn.trim() : null;
  const dpk = typeof payload.dpk === "string" && payload.dpk.trim() ? payload.dpk.trim() : null;
  return { userId: sub, sessionFamilyId, devicePublicKey: dpk };
}

export async function verifyAccessToken(token) {
  const { userId } = await parseAccessToken(token);
  return userId;
}
