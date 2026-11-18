import { getCashierSessionForAccount, rememberCashierSession } from "@/lib/commerce/payerCashierSessionCache";

/**
 * Session caisse pour le corps du pay — cache RAM, puis lecture GATT caisse fermée.
 */
export async function resolveCashierSessionForPay(
  merchantAccountId: string,
): Promise<number | null> {
  const id = merchantAccountId.trim().toUpperCase();
  if (!id) return null;
  const cached = getCashierSessionForAccount(id);
  if (cached != null) return cached;

  const { readCashierSessionViaGatt } = await import(
    "@/lib/ble/deliverReceiptViaCashierGatt"
  );
  const session = await readCashierSessionViaGatt(id);
  if (session != null) {
    rememberCashierSession({ accountId: id, sessionId: session });
  }
  return session;
}
