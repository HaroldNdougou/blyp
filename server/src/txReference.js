import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Même format que aws/lib/txReference.mjs — ex. BLYP-P260802-7KQ9XM2A */
export function makeTxReference(kind, at = new Date()) {
  const typeCode = kind === "DEPOSIT" ? "D" : "P";
  const y = String(at.getUTCFullYear()).slice(-2);
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const bytes = randomBytes(5);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code = CROCKFORD[Number(n % 32n)] + code;
    n /= 32n;
  }
  return `BLYP-${typeCode}${y}${m}${d}-${code}`;
}

export function fallbackTxReference(transactionId) {
  const hex = String(transactionId ?? "")
    .replace(/-/g, "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .padEnd(12, "0")
    .slice(0, 12);
  return `BLYP-${hex.slice(0, 4)}-${hex.slice(4, 12)}`;
}

export function resolveTxReference(row) {
  const ref = row?.reference != null ? String(row.reference).trim() : "";
  if (ref) return ref;
  return fallbackTxReference(row?.id);
}
