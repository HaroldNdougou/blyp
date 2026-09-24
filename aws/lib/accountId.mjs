import { randomBytes } from "node:crypto";

/** Alphabet Crockford — lisible au téléphone / support (sans I/L/O/U). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * ID compte public.
 * Ex. : `BLYP-U-7KQ9XM2A4B` (perso) / `BLYP-C-7KQ9XM2A4B` (commerce)
 * - BLYP : marque
 * - U | C : user | commerce
 * - 10 chars Crockford (~50 bits)
 */
export function makeAccountId() {
  return makePrefixedAccountId("U");
}

export function makeCommerceAccountId() {
  return makePrefixedAccountId("C");
}

function makePrefixedAccountId(kind) {
  const bytes = randomBytes(7);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let code = "";
  for (let i = 0; i < 10; i++) {
    code = CROCKFORD[Number(n % 32n)] + code;
    n /= 32n;
  }
  return `BLYP-${kind}-${code}`;
}

/** Fallback déterministe pour anciens profils (avant backfill). */
export function fallbackAccountId(userId) {
  const hex = String(userId ?? "")
    .replace(/-/g, "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .padEnd(20, "0")
    .slice(0, 20);
  let out = "";
  for (let i = 0; i < 10; i++) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    const v = parseInt(pair || "0", 16) % 32;
    out += CROCKFORD[v];
  }
  return `BLYP-U-${out}`;
}

export function resolveAccountId(profile) {
  const id = profile?.accountId != null ? String(profile.accountId).trim() : "";
  if (id) return id;
  return fallbackAccountId(profile?.userId ?? profile?.id);
}

export function accountPk(accountId) {
  return `ACCOUNT#${accountId}`;
}
