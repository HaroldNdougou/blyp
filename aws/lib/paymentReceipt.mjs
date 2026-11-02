import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/** Doit correspondre à lib/pay/paymentReceiptEd25519PublicKey.ts */
const PAY_RECEIPT_ED25519_PUBLIC_KEY_B64 =
  process.env.PAY_RECEIPT_ED25519_PUBLIC_KEY_B64?.trim() ||
  "5A9hlXFo5vQo5Anme0Mo6wDoy+hfUfYY0ZMD47oqX3w=";

export const PAY_RECEIPT_TTL_MS = 60_000;
export const PAY_RECEIPT_VERSION = 2;
export const PAY_RECEIPT_BLE_VERSION = 2;

let privateKeyObj = null;
let publicKeyObj = null;

function sortedJson(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function getPrivateKey() {
  if (privateKeyObj) return privateKeyObj;
  const pem = String(process.env.PAY_RECEIPT_ED25519_PRIVATE_KEY_PEM ?? "")
    .trim()
    .replace(/\\n/g, "\n");
  if (!pem) return null;
  privateKeyObj = createPrivateKey(pem);
  return privateKeyObj;
}

function getPublicKey() {
  if (publicKeyObj) return publicKeyObj;
  const pubRaw = Buffer.from(PAY_RECEIPT_ED25519_PUBLIC_KEY_B64, "base64");
  publicKeyObj = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      pubRaw,
    ]),
    format: "der",
    type: "spki",
  });
  return publicKeyObj;
}

export function buildReceiptSignMessage(receipt) {
  const { sig: _s, ...rest } = receipt;
  return sortedJson(rest);
}

export function signReceiptBody(bodyWithoutSig) {
  const key = getPrivateKey();
  if (!key) throw new Error("PAY_RECEIPT_ED25519_PRIVATE_KEY_PEM manquant");
  const msg = Buffer.from(sortedJson(bodyWithoutSig), "utf8");
  return sign(null, msg, key).toString("base64url");
}

export function verifyCommercePaymentReceipt(receipt) {
  if (!receipt || receipt.v !== PAY_RECEIPT_VERSION) return false;
  if (Date.now() > Number(receipt.expiresAt)) return false;
  const sigB64 = String(receipt.sig ?? "").trim();
  if (!sigB64) return false;
  let sigBuf;
  try {
    const pad =
      sigB64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (sigB64.length % 4)) % 4);
    sigBuf = Buffer.from(pad, "base64");
  } catch {
    return false;
  }
  if (sigBuf.length !== 64) return false;
  const msg = Buffer.from(buildReceiptSignMessage(receipt), "utf8");
  try {
    return verify(null, msg, getPublicKey(), sigBuf);
  } catch {
    return false;
  }
}

export function buildCommercePaymentReceipt({
  transactionId,
  reference,
  amountFcfa,
  recipientAccountId,
  commerceId,
  cashierSession = null,
}) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + PAY_RECEIPT_TTL_MS;
  const body = {
    v: PAY_RECEIPT_VERSION,
    transactionId: String(transactionId),
    reference: reference ? String(reference) : null,
    amountFcfa: Math.floor(amountFcfa),
    recipientAccountId: String(recipientAccountId ?? "").trim().toUpperCase(),
    commerceId: commerceId ? String(commerceId) : null,
    cashierSession:
      cashierSession != null && Number.isFinite(Number(cashierSession))
        ? Math.floor(Number(cashierSession)) >>> 0
        : null,
    issuedAt,
    expiresAt,
  };
  const sig = signReceiptBody(body);
  return { ...body, sig };
}

/** @deprecated — compat tests */
export function paymentTxFingerprint(transactionId) {
  return String(transactionId ?? "")
    .replace(/-/g, "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);
}

export function signCompactBleMac() {
  throw new Error("HMAC compact retiré — utiliser relai chunk Ed25519");
}

export function verifyCompactBleMac() {
  return false;
}

export function getPayReceiptPepper() {
  return "";
}
