/**
 * Génération locale (mock) — même format que `aws/lib/accountId.mjs`.
 * En prod AWS, l’ID compte fait foi côté serveur.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomCrockford(len: number): string {
  let code = "";
  for (let i = 0; i < len; i++) {
    code += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)]!;
  }
  return code;
}

/** Ex. BLYP-U-7KQ9XM2A4B */
export function makeAccountId(): string {
  return `BLYP-U-${randomCrockford(10)}`;
}

export function fallbackAccountId(userId: string): string {
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
    out += CROCKFORD[v]!;
  }
  return `BLYP-U-${out}`;
}
