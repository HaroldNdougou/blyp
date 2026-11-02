import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import { verifyCommercePaymentReceiptSync } from "@/lib/pay/paymentReceipt";
import {
  deliverReceiptViaCashierGatt,
  deliverReceiptViaCashierGattDeferred,
} from "@/lib/ble/deliverReceiptViaCashierGatt";

/** Relai caisse fermée — connexion directe GATT (plus de broadcast preuve). */
export async function relayCommercePaymentReceiptBle(input: {
  receipt: CommercePaymentReceipt;
  merchantAccountId: string;
}): Promise<void> {
  if (!verifyCommercePaymentReceiptSync(input.receipt)) return;
  await deliverReceiptViaCashierGatt({
    receipt: input.receipt,
    merchantAccountId: input.merchantAccountId,
  });
}

export function relayCommercePaymentReceiptBleDeferred(input: {
  receipt: CommercePaymentReceipt | null | undefined;
  merchantAccountId?: string | null | undefined;
}): void {
  deliverReceiptViaCashierGattDeferred({
    receipt: input.receipt,
    merchantAccountId: input.merchantAccountId,
  });
}
