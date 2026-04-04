import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Paramètres scrypt (alignés usage « secret utilisateur » court). */
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizePinDigits(pin) {
  return String(pin ?? "").replace(/\D/g, "");
}

/**
 * @param {string} pin
 * @param {string} pepper env TRANSACTION_PIN_PEPPER
 * @returns {string}
 */
export function hashTransactionPin(pin, pepper) {
  const d = normalizePinDigits(pin);
  if (d.length !== 4) {
    throw new Error("PIN_INVALID");
  }
  const p = String(pepper ?? "").trim();
  if (!p) {
    throw new Error("PIN_PEPPER_MISSING");
  }
  const salt = randomBytes(16);
  const key = scryptSync(`${p}|${d}`, salt, 32, SCRYPT_OPTS);
  return `s1$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * @param {string} pin
 * @param {string | null | undefined} stored
 * @param {string} pepper
 */
export function verifyTransactionPin(pin, stored, pepper) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "s1") return false;
  const [, saltHex, keyHex] = parts;
  if (!saltHex || !keyHex || saltHex.length % 2 !== 0) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== 32) return false;
  const d = normalizePinDigits(pin);
  if (d.length !== 4) return false;
  const p = String(pepper ?? "").trim();
  if (!p) return false;
  try {
    const key = scryptSync(`${p}|${d}`, salt, 32, SCRYPT_OPTS);
    if (key.length !== expected.length) return false;
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
