/** Séparateur sûr (pas présent dans les ISO dates). */
const SEP = "\u001f";

export function packReceiptGeneration(
  peerLastReadAt: string | null | undefined,
  peerLastDeliveredAt: string | null | undefined,
): string {
  return `${peerLastReadAt ?? ""}${SEP}${peerLastDeliveredAt ?? ""}`;
}

export function unpackReceiptGeneration(packed: string): {
  peerLastReadAt: string | null;
  peerLastDeliveredAt: string | null;
} {
  const i = packed.indexOf(SEP);
  if (i < 0) {
    return { peerLastReadAt: packed || null, peerLastDeliveredAt: null };
  }
  const read = packed.slice(0, i);
  const del = packed.slice(i + 1);
  return {
    peerLastReadAt: read || null,
    peerLastDeliveredAt: del || null,
  };
}
