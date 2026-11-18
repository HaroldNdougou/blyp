import { PAY_RECEIPT_TTL_MS } from "@/lib/pay/paymentReceipt";
import type { ApiUser } from "@/lib/api/types";
import { formatCameroonPhoneDisplay } from "@/lib/format";

/** OK caisse tout de suite — pas la preuve serveur (encaissement après). */
export type LocalCommercePayNotice = {
  v: 2;
  localAccept: true;
  transactionId: string;
  idempotencyKey: string;
  reference: string;
  payerPhone: string | null;
  amountFcfa: number;
  recipientAccountId: string;
  commerceId: string | null;
  cashierSession: number;
  issuedAt: number;
  expiresAt: number;
};

export function isLocalCommercePayNotice(
  value: unknown,
): value is LocalCommercePayNotice {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return o.localAccept === true && o.v === 2;
}

export function payerDisplayNameForLocalNotice(
  user: ApiUser,
  phoneDigits: string,
): string {
  const fn = user.personalFirstName ?? user.firstName;
  const ln = user.personalLastName ?? user.lastName;
  const name = [fn, ln].filter(Boolean).join(" ").trim();
  if (name) return name;
  const phone = String(phoneDigits ?? user.phone ?? "").trim();
  if (phone) return formatCameroonPhoneDisplay(phone);
  return "—";
}

export function buildLocalCommercePayNotice(input: {
  idempotencyKey: string;
  optimisticTxId: string;
  amountFcfa: number;
  recipientAccountId: string;
  commerceId?: string | null;
  cashierSession: number | null;
  payerName: string;
  payerPhone: string | null;
}): LocalCommercePayNotice | null {
  const session = input.cashierSession;
  if (session == null || !Number.isFinite(session)) return null;
  const amount = Math.floor(Number(input.amountFcfa));
  if (amount <= 0) return null;
  const recipient = input.recipientAccountId.trim().toUpperCase();
  if (!recipient) return null;
  const issuedAt = Date.now();
  return {
    v: 2,
    localAccept: true,
    transactionId: input.optimisticTxId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    reference: input.payerName.trim() || "—",
    payerPhone: input.payerPhone?.trim() || null,
    amountFcfa: amount,
    recipientAccountId: recipient,
    commerceId: input.commerceId?.trim() || null,
    cashierSession: Math.floor(session) >>> 0,
    issuedAt,
    expiresAt: issuedAt + PAY_RECEIPT_TTL_MS,
  };
}
