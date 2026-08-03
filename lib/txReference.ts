/**
 * Génération locale (mock / offline) — même format que `aws/lib/txReference.mjs`.
 * En prod AWS, la référence fait foi côté serveur.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomCrockford(len: number): string {
  let code = "";
  for (let i = 0; i < len; i++) {
    code += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)]!;
  }
  return code;
}

export function makeTxReference(
  kind: "PAYMENT" | "DEPOSIT",
  at: Date = new Date(),
): string {
  const typeCode = kind === "DEPOSIT" ? "D" : "P";
  const y = String(at.getUTCFullYear()).slice(-2);
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  return `BLYP-${typeCode}${y}${m}${d}-${randomCrockford(8)}`;
}

export function fallbackTxReference(transactionId: string): string {
  const hex = String(transactionId ?? "")
    .replace(/-/g, "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .padEnd(12, "0")
    .slice(0, 12);
  return `BLYP-${hex.slice(0, 4)}-${hex.slice(4, 12)}`;
}
