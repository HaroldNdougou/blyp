import type { LocalCommercePayNotice } from "@/lib/pay/localCommercePayNotice";
import { deliverPayPayloadViaCashierGattDeferred } from "@/lib/ble/deliverReceiptViaCashierGatt";

export function relayLocalCommercePayNoticeBleDeferred(input: {
  notice: LocalCommercePayNotice | null | undefined;
  merchantAccountId: string | null | undefined;
}): void {
  if (!input.notice || !input.merchantAccountId) return;
  deliverPayPayloadViaCashierGattDeferred({
    payloadJson: JSON.stringify(input.notice),
    merchantAccountId: input.merchantAccountId,
  });
}
