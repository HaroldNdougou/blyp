const TTL_MS = 120_000;
const recent = new Map<string, number>();

function dedupeKey(input: {
  amountFcfa: number;
  reference: string;
  cashierSession: number;
}): string {
  return `${input.amountFcfa}|${input.reference.trim().toLowerCase()}|${input.cashierSession >>> 0}`;
}

export function markLocalPayAnnounced(input: {
  amountFcfa: number;
  reference: string;
  cashierSession: number;
}): void {
  const key = dedupeKey(input);
  recent.set(key, Date.now() + TTL_MS);
  if (recent.size > 40) {
    const now = Date.now();
    for (const [k, exp] of recent) {
      if (exp < now) recent.delete(k);
    }
  }
}

export function shouldSkipVoiceAfterLocalAnnounce(input: {
  amountFcfa: number;
  reference: string | null;
  cashierSession: number | null;
}): boolean {
  if (input.cashierSession == null) return false;
  const ref = (input.reference ?? "").trim() || "—";
  const key = dedupeKey({
    amountFcfa: input.amountFcfa,
    reference: ref,
    cashierSession: input.cashierSession,
  });
  const exp = recent.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    recent.delete(key);
    return false;
  }
  return true;
}
