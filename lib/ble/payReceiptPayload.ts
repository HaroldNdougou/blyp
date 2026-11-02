import { base64ToBytes } from "@/lib/ble/base64";
import { BLYP_BLE_COMPANY_ID } from "@/lib/ble/constants";
import { accountIdToCode } from "@/lib/ble/payload";
import {
  hmacSha256,
  timingSafeEqualBytes,
} from "@/lib/crypto/hmacSha256";
import {
  getPayReceiptPepperClient,
  PAY_RECEIPT_BLE_VERSION,
  paymentTxFingerprint,
  verifyCompactBleMac,
} from "@/lib/pay/paymentReceipt";

const MAGIC0 = 0x42;
const MAGIC_RECEIPT = 0x52;
const PAYLOAD_LEN = 2 + 3 + 8 + 8;

export type ParsedBlePayReceipt = {
  amountFcfa: number;
  txFp: string;
  mac8: Uint8Array;
};

function readAmount3(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16)) >>>
    0
  );
}

function writeAmount3(amount: number, out: number[], at: number): void {
  const a = Math.floor(amount) >>> 0;
  out[at] = a & 0xff;
  out[at + 1] = (a >> 8) & 0xff;
  out[at + 2] = (a >> 16) & 0xff;
}

function readAsciiFp(bytes: Uint8Array, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const b = bytes[offset + i]!;
    if (b < 0x30 || b > 0x7a) return "";
    s += String.fromCharCode(b);
  }
  return s.toLowerCase();
}

function decodePayloadAt(
  bytes: Uint8Array,
  offset: number,
): ParsedBlePayReceipt | null {
  if (bytes.length - offset < PAYLOAD_LEN) return null;
  if (bytes[offset] !== MAGIC0 || bytes[offset + 1] !== MAGIC_RECEIPT) {
    return null;
  }
  const amountFcfa = readAmount3(bytes, offset + 2);
  if (amountFcfa <= 0 || amountFcfa > 999_999) return null;
  const txFp = readAsciiFp(bytes, offset + 5, 8);
  if (txFp.length !== 8) return null;
  const mac8 = bytes.subarray(offset + 13, offset + 21);
  return { amountFcfa, txFp, mac8 };
}

function findCompanyOffset(raw: Uint8Array): number {
  if (raw.length < 4) return 0;
  const companyLe = raw[0]! | (raw[1]! << 8);
  const companyBe = (raw[0]! << 8) | raw[1]!;
  if (companyLe === BLYP_BLE_COMPANY_ID || companyBe === BLYP_BLE_COMPANY_ID) {
    return 2;
  }
  return 0;
}

export function parseBlePayReceiptFromBytes(
  raw: Uint8Array | null,
): ParsedBlePayReceipt | null {
  if (!raw || raw.length < PAYLOAD_LEN) return null;
  const offset = findCompanyOffset(raw);
  const direct = decodePayloadAt(raw, offset);
  if (direct) return direct;
  for (let i = 0; i + PAYLOAD_LEN <= raw.length; i++) {
    const hit = decodePayloadAt(raw, i);
    if (hit) return hit;
  }
  return null;
}

export function parseBlePayReceiptFromScan(input: {
  manufacturerData?: string | null;
  rawScanRecord?: string | null;
}): ParsedBlePayReceipt | null {
  if (input.manufacturerData) {
    const raw = base64ToBytes(input.manufacturerData);
    const hit = raw ? parseBlePayReceiptFromBytes(raw) : null;
    if (hit) return hit;
  }
  if (input.rawScanRecord) {
    const raw = base64ToBytes(input.rawScanRecord);
    return raw ? parseBlePayReceiptFromBytes(raw) : null;
  }
  return null;
}

export function encodeBlePayReceiptManufBytes(input: {
  transactionId: string;
  amountFcfa: number;
  mac8: Uint8Array;
}): number[] | null {
  const txFp = paymentTxFingerprint(input.transactionId);
  if (txFp.length !== 8 || input.mac8.length !== 8) return null;
  const amount = Math.floor(input.amountFcfa);
  if (amount <= 0 || amount > 999_999) return null;
  const out: number[] = [MAGIC0, MAGIC_RECEIPT];
  writeAmount3(amount, out, out.length);
  for (let i = 0; i < 8; i++) out.push(txFp.charCodeAt(i));
  for (let i = 0; i < 8; i++) out.push(input.mac8[i]!);
  return out;
}

export function verifyParsedBlePayReceiptForMerchant(input: {
  parsed: ParsedBlePayReceipt;
  merchantAccountId: string;
}): boolean {
  const accountId = input.merchantAccountId.trim().toUpperCase();
  if (!accountIdToCode(accountId)) return false;
  return verifyCompactBleMac({
    amountFcfa: input.parsed.amountFcfa,
    txFp: input.parsed.txFp,
    recipientAccountId: accountId,
    mac8: input.parsed.mac8,
  });
}

export function mac8ForCommerceReceipt(receipt: {
  transactionId: string;
  amountFcfa: number;
  recipientAccountId: string;
}): Uint8Array {
  const txFp = paymentTxFingerprint(receipt.transactionId);
  const code = accountIdToCode(receipt.recipientAccountId)?.code ?? "";
  const msg = `BR${PAY_RECEIPT_BLE_VERSION}|${Math.floor(receipt.amountFcfa)}|${txFp}|${code}`;
  return hmacSha256(getPayReceiptPepperClient(), msg).subarray(0, 8);
}
