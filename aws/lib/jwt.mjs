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

export async function signAccessToken(userId) {
  return new SignJWT({ typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRY)
    .sign(getSecretKey());
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, getSecretKey());
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("INVALID_TOKEN");
  }
  return sub;
}
