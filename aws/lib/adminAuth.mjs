import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SignJWT, jwtVerify } from "jose";
import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";

/**
 * Authentification du tableau de bord admin.
 *
 *  - mot de passe : scrypt (sel aléatoire, comparaison à temps constant) ;
 *  - 2e facteur : TOTP RFC 6238 (Google Authenticator / Authy), anti-rejeu ;
 *  - session : JWT HS256 dédié (secret + audience distincts de l'app) ;
 *  - actions sensibles : jeton d'« élévation » 5 min (nouveau mot de passe + TOTP) ;
 *  - verrouillage après échecs répétés.
 */

const scrypt = promisify(scryptCb);
const doc = getDocClient();

export const SESSION_TTL_SEC = 8 * 60 * 60;
export const ELEVATION_TTL_SEC = 5 * 60;
const SESSION_AUD = "blyp-admin";
const ELEVATION_AUD = "blyp-admin-elevation";
const ISSUER = "blyp";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

const LOCK_MAX_FAILS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

export function adminConfig() {
  const env = process.env;
  const list = (v, lower = false) =>
    String(v ?? "")
      .split(/[,;\s]+/)
      .map((x) => (lower ? x.trim().toLowerCase() : x.trim()))
      .filter(Boolean);
  const emails = [...new Set(list(env.ADMIN_EMAIL, true))];
  const pushPhones = [...new Set(list(env.ADMIN_PUSH_PHONE))];
  return {
    /** Tous les fondateurs : mêmes droits, mêmes notifications (plusieurs adresses = secours). */
    emails,
    email: emails[0] ?? "",
    pushPhones,
    passwordHash: String(env.ADMIN_PASSWORD_HASH ?? "").trim(),
    totpSecret: String(env.ADMIN_TOTP_SECRET ?? "").trim(),
    jwtSecret: String(env.ADMIN_JWT_SECRET ?? "").trim(),
    senderEmail: String(env.ADMIN_SENDER_EMAIL ?? "").trim(),
    pushPhone: pushPhones[0] ?? "",
    allowedIps: String(env.ADMIN_ALLOWED_IPS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function isAdminConfigured(cfg = adminConfig()) {
  return Boolean(
    cfg.emails.length > 0 &&
      cfg.passwordHash &&
      cfg.totpSecret &&
      cfg.jwtSecret &&
      cfg.jwtSecret.length >= 32,
  );
}

/* -------------------------------------------------------------------------- */
/* Mot de passe (scrypt)                                                       */
/* -------------------------------------------------------------------------- */

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** Format : `s1:N:r:p:<salt b64url>:<hash b64url>` (aucun `$`, sûr en variable d'env). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `s1:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${b64u(salt)}:${b64u(key)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split(":");
  if (parts.length !== 6 || parts[0] !== "s1") return false;
  const [, nS, rS, pS, saltS, hashS] = parts;
  const N = Number(nS);
  const r = Number(rS);
  const p = Number(pS);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  const salt = Buffer.from(saltS, "base64url");
  const expected = Buffer.from(hashS, "base64url");
  if (!salt.length || !expected.length) return false;
  const key = await scrypt(String(password), salt, expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/* -------------------------------------------------------------------------- */
/* TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s)                             */
/* -------------------------------------------------------------------------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("INVALID_BASE32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secretB32, timeMs = Date.now(), stepSec = 30) {
  const counter = Math.floor(timeMs / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/**
 * @returns {number | null} pas (counter) correspondant, ou null.
 * Fenêtre ±1 pas pour tolérer la dérive d'horloge.
 */
export function matchTotp(secretB32, code, timeMs = Date.now()) {
  const given = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  for (const drift of [0, -1, 1]) {
    const t = timeMs + drift * 30_000;
    const expected = totpCode(secretB32, t);
    if (
      timingSafeEqual(Buffer.from(expected), Buffer.from(given))
    ) {
      return Math.floor(t / 1000 / 30);
    }
  }
  return null;
}

export function otpauthUri(secretB32, account, issuer = "Blyp Admin") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    account,
  )}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Un même code ne peut servir qu'une fois par usage (connexion / élévation). */
async function claimTotpStep(purpose, step) {
  try {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: `ATOTP#${purpose}`,
          SK: String(step),
          expiresAt: ttlFromNowMs(10 * 60 * 1000),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Verrouillage                                                                */
/* -------------------------------------------------------------------------- */

const LOCK_KEY = { PK: "ALOCK#admin", SK: "STATE" };

export async function lockRemainingSec(now = Date.now()) {
  const res = await doc.send(
    new GetCommand({ TableName: getTableName(), Key: LOCK_KEY }),
  );
  const until = Number(res.Item?.lockedUntil ?? 0);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export async function recordFailure(now = Date.now()) {
  const res = await doc.send(
    new GetCommand({ TableName: getTableName(), Key: LOCK_KEY }),
  );
  let fails = Number(res.Item?.fails ?? 0);
  let windowStart = Number(res.Item?.windowStart ?? 0);
  if (!windowStart || now - windowStart > LOCK_WINDOW_MS) {
    fails = 0;
    windowStart = now;
  }
  fails += 1;
  const lockedUntil = fails >= LOCK_MAX_FAILS ? now + LOCK_DURATION_MS : 0;
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        ...LOCK_KEY,
        fails: lockedUntil ? 0 : fails,
        windowStart,
        lockedUntil,
        updatedAt: new Date(now).toISOString(),
        expiresAt: ttlFromNowMs(2 * 60 * 60 * 1000),
      },
    }),
  );
  return { fails, locked: Boolean(lockedUntil) };
}

export async function clearFailures() {
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: LOCK_KEY,
      UpdateExpression: "SET fails = :z, lockedUntil = :z, updatedAt = :now",
      ExpressionAttributeValues: { ":z": 0, ":now": new Date().toISOString() },
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Jetons                                                                      */
/* -------------------------------------------------------------------------- */

function secretKey(cfg) {
  return new TextEncoder().encode(cfg.jwtSecret);
}

async function signToken(cfg, aud, ttlSec, claims = {}, email = cfg.email) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(secretKey(cfg));
}

export const signSession = (cfg = adminConfig(), email = cfg.email) =>
  signToken(cfg, SESSION_AUD, SESSION_TTL_SEC, { typ: "admin-session" }, email);

export const signElevation = (cfg = adminConfig(), email = cfg.email) =>
  signToken(cfg, ELEVATION_AUD, ELEVATION_TTL_SEC, { typ: "admin-elevation" }, email);

async function verifyToken(cfg, token, aud) {
  try {
    const { payload } = await jwtVerify(token, secretKey(cfg), {
      audience: aud,
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    return cfg.emails.includes(String(payload.sub ?? "")) ? payload : null;
  } catch {
    return null;
  }
}

export const verifySession = (token, cfg = adminConfig()) =>
  token ? verifyToken(cfg, token, SESSION_AUD) : Promise.resolve(null);

export const verifyElevation = (token, cfg = adminConfig()) =>
  token ? verifyToken(cfg, token, ELEVATION_AUD) : Promise.resolve(null);

/* -------------------------------------------------------------------------- */
/* Flux login / élévation                                                      */
/* -------------------------------------------------------------------------- */

const DUMMY_HASH =
  "s1:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + Buffer.alloc(64).toString("base64url");

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: "NOT_CONFIGURED"|"LOCKED"|"INVALID", retryAfterSec?: number }>}
 */
export async function checkCredentials({ email, password, totp, purpose }, cfg = adminConfig()) {
  if (!isAdminConfigured(cfg)) return { ok: false, reason: "NOT_CONFIGURED" };
  const locked = await lockRemainingSec();
  if (locked > 0) return { ok: false, reason: "LOCKED", retryAfterSec: locked };

  const given = String(email ?? "").trim().toLowerCase();
  const emailOk = purpose === "elevation" || cfg.emails.includes(given);
  /** Toujours calculer le hash (pas de fuite par temps de réponse). */
  const passOk = await verifyPassword(
    password,
    emailOk ? cfg.passwordHash : DUMMY_HASH,
  );
  const step = matchTotp(cfg.totpSecret, totp);
  let totpOk = false;
  if (step != null) totpOk = await claimTotpStep(purpose, step);

  if (emailOk && passOk && totpOk) {
    await clearFailures();
    return { ok: true, email: cfg.emails.includes(given) ? given : cfg.email };
  }
  const rec = await recordFailure();
  return rec.locked
    ? { ok: false, reason: "LOCKED", retryAfterSec: LOCK_DURATION_MS / 1000 }
    : { ok: false, reason: "INVALID" };
}

/* -------------------------------------------------------------------------- */
/* Requête HTTP                                                                */
/* -------------------------------------------------------------------------- */

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeSec = SESSION_TTL_SEC) {
  return `blyp_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie() {
  return "blyp_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

export function headerOf(event, name) {
  const h = event?.headers ?? {};
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
}

export function clientIp(event) {
  return event?.requestContext?.http?.sourceIp ?? null;
}

export function ipAllowed(event, cfg = adminConfig()) {
  if (!cfg.allowedIps.length) return true;
  const ip = clientIp(event);
  return Boolean(ip) && cfg.allowedIps.includes(ip);
}

/**
 * Session valide : cookie web (SameSite=Strict) OU Bearer (app admin mobile).
 * Méthodes qui modifient l'état : en-tête anti-CSRF personnalisé obligatoire.
 */
export async function requireSession(event, { csrf = true } = {}, cfg = adminConfig()) {
  if (csrf && headerOf(event, "x-requested-with") !== "blyp-admin") return null;
  const auth = String(headerOf(event, "authorization") ?? "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return verifySession(bearer, cfg);
  const cookies = parseCookies(
    event?.cookies?.length ? event.cookies.join(";") : headerOf(event, "cookie"),
  );
  return verifySession(cookies.blyp_admin, cfg);
}
