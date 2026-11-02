import * as ed from "@noble/ed25519";
import { PAY_RECEIPT_ED25519_PUBLIC_KEY_B64 } from "@/lib/pay/paymentReceiptEd25519PublicKey";

export const PAY_RECEIPT_TTL_MS = 60_000;
export const PAY_RECEIPT_VERSION = 2;

export type CommercePaymentReceipt = {
  v: 2;
  transactionId: string;
  reference: string | null;
  amountFcfa: number;
  recipientAccountId: string;
  commerceId: string | null;
  cashierSession: number | null;
  issuedAt: number;
  expiresAt: number;
  sig: string;
};

let publicKeyBytes: Uint8Array | null = null;

function getPublicKeyBytes(): Uint8Array {
  if (!publicKeyBytes) {
    publicKeyBytes = Uint8Array.from(
      atob(PAY_RECEIPT_ED25519_PUBLIC_KEY_B64),
      (c) => c.charCodeAt(0),
    );
  }
  return publicKeyBytes;
}

function sortedJson(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

export function buildReceiptSignMessage(
  receipt: Omit<CommercePaymentReceipt, "sig"> & { sig?: string },
): string {
  const { sig: _s, ...rest } = receipt;
  return sortedJson(rest as Record<string, unknown>);
}

function sigBase64UrlToBytes(sig: string): Uint8Array | null {
  try {
    const pad =
      sig.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (sig.length % 4)) % 4);
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length === 64 ? out : null;
  } catch {
    return null;
  }
}

export async function verifyCommercePaymentReceipt(
  receipt: CommercePaymentReceipt | null | undefined,
): Promise<boolean> {
  if (!receipt || receipt.v !== PAY_RECEIPT_VERSION) return false;
  if (Date.now() > receipt.expiresAt) return false;
  const sigBytes = sigBase64UrlToBytes(String(receipt.sig ?? ""));
  if (!sigBytes) return false;
  const msg = new TextEncoder().encode(buildReceiptSignMessage(receipt));
  return ed.verifyAsync(sigBytes, msg, getPublicKeyBytes());
}

export function verifyCommercePaymentReceiptSync(
  receipt: CommercePaymentReceipt | null | undefined,
): boolean {
  if (!receipt || receipt.v !== PAY_RECEIPT_VERSION) return false;
  if (Date.now() > receipt.expiresAt) return false;
  const sigBytes = sigBase64UrlToBytes(String(receipt.sig ?? ""));
  if (!sigBytes) return false;
  const msg = new TextEncoder().encode(buildReceiptSignMessage(receipt));
  return ed.verify(sigBytes, msg, getPublicKeyBytes());
}

export function paymentTxFingerprint(transactionId: string): string {
  return String(transactionId ?? "")
    .replace(/-/g, "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);
}

export function txIdMatchesFingerprint(
  transactionId: string,
  txFp: string,
): boolean {
  return paymentTxFingerprint(transactionId) === txFp.toLowerCase();
}

/** Dev mock — clé privée paire locale uniquement (jamais en prod AWS). */
const MOCK_DEV_PRIVATE_KEY_B64 =
  "vCPV3V3OW_iaeeXaWFYBPrSn3cxOYyLr8m_UeUmKGXA";

export function buildMockCommercePaymentReceiptSync(input: {
  transactionId: string;
  reference: string;
  amountFcfa: number;
  recipientAccountId: string;
  commerceId: string;
  cashierSession?: number | null;
}): CommercePaymentReceipt {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + PAY_RECEIPT_TTL_MS;
  const body = {
    v: 2 as const,
    transactionId: input.transactionId,
    reference: input.reference,
    amountFcfa: Math.floor(input.amountFcfa),
    recipientAccountId: input.recipientAccountId.trim().toUpperCase(),
    commerceId: input.commerceId,
    cashierSession:
      input.cashierSession != null
        ? Math.floor(input.cashierSession) >>> 0
        : null,
    issuedAt,
    expiresAt,
  };
  const priv = Uint8Array.from(atob(MOCK_DEV_PRIVATE_KEY_B64), (c) =>
    c.charCodeAt(0),
  );
  const msg = new TextEncoder().encode(buildReceiptSignMessage(body));
  const sigBytes = ed.sign(msg, priv);
  const sig = bytesToBase64Url(sigBytes);
  return { ...body, sig };
}

export async function buildMockCommercePaymentReceipt(input: {
  transactionId: string;
  reference: string;
  amountFcfa: number;
  recipientAccountId: string;
  commerceId: string;
  cashierSession?: number | null;
}): Promise<CommercePaymentReceipt> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + PAY_RECEIPT_TTL_MS;
  const body = {
    v: 2 as const,
    transactionId: input.transactionId,
    reference: input.reference,
    amountFcfa: Math.floor(input.amountFcfa),
    recipientAccountId: input.recipientAccountId.trim().toUpperCase(),
    commerceId: input.commerceId,
    cashierSession:
      input.cashierSession != null
        ? Math.floor(input.cashierSession) >>> 0
        : null,
    issuedAt,
    expiresAt,
  };
  const priv = Uint8Array.from(atob(MOCK_DEV_PRIVATE_KEY_B64), (c) =>
    c.charCodeAt(0),
  );
  const msg = new TextEncoder().encode(buildReceiptSignMessage(body));
  const sigBytes = await ed.signAsync(msg, priv);
  const sig = bytesToBase64Url(sigBytes);
  return { ...body, sig };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @deprecated pepper retiré */
export function getPayReceiptPepperClient(): string {
  return "";
}
