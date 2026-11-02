/** Idempotence paiement — évite double débit réseau. */
export function newPayIdempotencyKey(): string {
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
