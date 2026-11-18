import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";

const STORE_KEY = "blyp.encashedReceiptTxIds.v1";
const MAX_IDS = 400;

let ids = new Set<string>();
let hydrateStarted = false;

function norm(txId: string): string {
  return txId.trim().toLowerCase();
}

async function persist(): Promise<void> {
  try {
    const SS = await import("expo-secure-store");
    const list = [...ids].slice(0, MAX_IDS);
    await SS.setItemAsync(STORE_KEY, JSON.stringify(list));
  } catch {
    /* RAM */
  }
}

export function hydrateEncashedReceiptIdsOnce(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  void (async () => {
    try {
      const SS = await import("expo-secure-store");
      const raw = await SS.getItemAsync(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (!Array.isArray(parsed)) return;
      ids = new Set(parsed.map(norm).filter(Boolean));
    } catch {
      /* ignore */
    }
  })();
}

export function isReceiptTransactionEncashedLocally(
  transactionId: string | null | undefined,
): boolean {
  hydrateEncashedReceiptIdsOnce();
  const k = norm(String(transactionId ?? ""));
  return k.length > 0 && ids.has(k);
}

export async function rememberEncashedReceiptTransactionId(
  transactionId: string,
): Promise<void> {
  hydrateEncashedReceiptIdsOnce();
  const k = norm(transactionId);
  if (!k) return;
  if (ids.has(k)) return;
  ids.add(k);
  if (ids.size > MAX_IDS) {
    ids = new Set([...ids].slice(-MAX_IDS));
  }
  await persist();
}

export async function mergeEncashedReceiptIdsFromServer(
  transactionIds: string[],
): Promise<void> {
  hydrateEncashedReceiptIdsOnce();
  let changed = false;
  for (const tx of transactionIds) {
    const k = norm(tx);
    if (!k || ids.has(k)) continue;
    ids.add(k);
    changed = true;
  }
  if (changed) await persist();
}

export type EncashedReceiptListItem = {
  transactionId: string;
  encashedAt: string;
  amountFcfa: number;
};

export async function syncEncashedReceiptIdsForCommerce(input: {
  commerceId: string;
  token: string;
  sinceIso?: string | null;
}): Promise<void> {
  const { fetchCommerceEncashedReceipts } = await import("@/lib/api/client");
  const res = await fetchCommerceEncashedReceipts(
    input.commerceId,
    input.token,
    input.sinceIso ?? null,
  );
  await mergeEncashedReceiptIdsFromServer(
    res.items.map((i) => i.transactionId),
  );
}
