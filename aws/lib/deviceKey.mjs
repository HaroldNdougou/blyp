/**
 * Clé appareil (modèle WhatsApp) : paire EC P-256 générée dans la puce sécurisée du téléphone,
 * jamais exportable. La session (refresh) et les actions d’argent sont signées par cette clé ;
 * un jeton volé est inutile hors du téléphone.
 */
import { createHash, createPublicKey, verify } from "node:crypto";

/** Écart d’horloge toléré entre téléphone et serveur. */
export const DEVICE_PROOF_MAX_SKEW_MS = 120_000;

export function sha256Hex(raw) {
  return createHash("sha256").update(raw ?? "", "utf8").digest("hex");
}

/** SPKI DER base64 → clé publique P-256 validée, ou null. */
const keyCache = new Map();

export function parseDevicePublicKey(b64) {
  const raw = String(b64 ?? "").trim();
  if (!raw || raw.length > 400) return null;
  const hit = keyCache.get(raw);
  if (hit) return hit;
  const key = parseUncached(raw);
  if (key) {
    if (keyCache.size > 5_000) keyCache.clear();
    keyCache.set(raw, key);
  }
  return key;
}

function parseUncached(raw) {
  try {
    const key = createPublicKey({
      key: Buffer.from(raw, "base64"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ec") return null;
    if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    return key;
  } catch {
    return null;
  }
}

/** Signature ECDSA SHA-256 (DER, base64) produite par Android Keystore. */
export function verifyDeviceSignature(publicKeyB64, message, signatureB64) {
  const key = parseDevicePublicKey(publicKeyB64);
  const sig = String(signatureB64 ?? "").trim();
  if (!key || !sig) return false;
  try {
    return verify(
      "sha256",
      Buffer.from(String(message), "utf8"),
      key,
      Buffer.from(sig, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Fin de la migration silencieuse : après cette date, toute session doit avoir une clé appareil
 * (connexion, renouvellement, actions d’argent). Avant : une session historique adopte la 1re clé
 * présentée avec un refresh valide.
 */
export const DEVICE_KEY_REQUIRED_FROM_MS = Date.parse("2026-11-14T00:00:00Z");

export function deviceKeyRequired(now = Date.now()) {
  return now >= DEVICE_KEY_REQUIRED_FROM_MS;
}

/** "ok" | "skew" (signature valide, horloge du téléphone décalée) | "bad" */
function verifyTimed(publicKeyB64, ts, message, sig) {
  const n = Number(ts);
  if (!Number.isFinite(n) || !verifyDeviceSignature(publicKeyB64, message, sig)) return "bad";
  return Math.abs(Date.now() - n) <= DEVICE_PROOF_MAX_SKEW_MS ? "ok" : "skew";
}

/** Message signé pour /auth/refresh — lie la preuve à ce refresh précis. */
export function refreshProofMessage(ts, refreshTokenRaw) {
  return `blyp-refresh
${ts}
${sha256Hex(String(refreshTokenRaw))}`;
}

export function checkRefreshProof(publicKeyB64, refreshTokenRaw, proof) {
  const ts = proof?.ts;
  return verifyTimed(publicKeyB64, ts, refreshProofMessage(ts, refreshTokenRaw), proof?.sig);
}

export function verifyRefreshProof(publicKeyB64, refreshTokenRaw, proof) {
  return checkRefreshProof(publicKeyB64, refreshTokenRaw, proof) === "ok";
}

/** Message signé pour une requête sensible (méthode + chemin + horodatage + corps). */
export function requestProofMessage(method, path, ts, bodyRaw) {
  return `blyp-req
${String(method).toUpperCase()}
${path}
${ts}
${sha256Hex(bodyRaw ?? "")}`;
}

function header(event, name) {
  const h = event?.headers ?? {};
  return String(h[name] ?? h[name.toLowerCase()] ?? "").trim();
}

function rawBody(event) {
  const b = event?.body;
  if (b == null) return "";
  return event?.isBase64Encoded ? Buffer.from(b, "base64").toString("utf8") : String(b);
}

/**
 * Jeton lié à une clé appareil (`dpk`) ⇒ preuve obligatoire.
 * Jeton historique sans clé ⇒ accepté seulement pendant la migration.
 * @returns {"ok" | "skew" | "bad"}
 */
export function checkRequestProof(event, devicePublicKey, method, path) {
  if (!devicePublicKey) return deviceKeyRequired() ? "bad" : "ok";
  const ts = header(event, "x-blyp-ts");
  const sig = header(event, "x-blyp-sig");
  if (!ts || !sig) return "bad";
  return verifyTimed(devicePublicKey, ts, requestProofMessage(method, path, ts, rawBody(event)), sig);
}

/** Actions d’argent / PIN : signées par la clé appareil. */
const SENSITIVE_ROUTES = [
  ["POST", /^\/payments\/pay$/],
  ["POST", /^\/wallet\/deposit$/],
  ["POST", /^\/pockets$/],
  ["POST", /^\/pockets\/[^/]+\/move$/],
  ["DELETE", /^\/pockets\/[^/]+$/],
  ["POST", /^\/auth\/onboarding\/transaction-pin$/],
  ["PUT", /^\/me\/small-pay-without-pin$/],
  ["POST", /^\/commerces\/[^/]+\/payment-receipts\/encash$/],
];

export function isSensitiveRoute(method, path) {
  const m = String(method ?? "").toUpperCase();
  return SENSITIVE_ROUTES.some(([rm, re]) => rm === m && re.test(String(path ?? "")));
}

export const DEVICE_PROOF_INVALID_CODE = "DEVICE_PROOF_INVALID";
export const DEVICE_CLOCK_SKEW_CODE = "DEVICE_CLOCK_SKEW";
export const DEVICE_KEY_REQUIRED_CODE = "DEVICE_KEY_REQUIRED";
