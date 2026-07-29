import { SignJWT, jwtVerify } from "jose";

const JWT_EXPIRY = "30d";

function getSecretKey() {
  const secret = process.env.JWT_SECRET?.trim() || "dev-insecure";
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(userId) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
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
