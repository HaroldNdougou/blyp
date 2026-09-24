/**
 * Payload BLE (manufacturer, ≤ ~24 octets) :
 *   B + (P|C) (2) | accountCode (10) | phone9 (9)  = 21 octets
 * P = perso (BLYP-U-), C = commerce (BLYP-C-).
 */
import { base64ToBytes } from "@/lib/ble/base64";
import {
  BLYP_BLE_COMPANY_ID,
  BLYP_BLE_DEMO_ACCOUNT_ID,
  BLYP_BLE_DEMO_PHONE,
  BLYP_BLE_NAME_PREFIX,
} from "@/lib/ble/constants";
import type { BleTaxiPeer } from "@/lib/ble/types";

const USER_PREFIX = "BLYP-U-";
const COMMERCE_PREFIX = "BLYP-C-";
const MAGIC0 = 0x42; // B
const MAGIC_USER = 0x50; // P
const MAGIC_COMMERCE = 0x43; // C
const CODE_LEN = 10;
const PHONE_LEN = 9;
const BINARY_LEN = 2 + CODE_LEN + PHONE_LEN;

type AccountKind = "user" | "commerce";

function codeToAccountId(code: string, kind: AccountKind): string {
  const prefix = kind === "commerce" ? COMMERCE_PREFIX : USER_PREFIX;
  return `${prefix}${code.toUpperCase()}`;
}

export function accountIdToCode(accountId: string): {
  code: string;
  kind: AccountKind;
} | null {
  const id = String(accountId ?? "")
    .trim()
    .toUpperCase();
  let kind: AccountKind | null = null;
  let code = "";
  if (id.startsWith(USER_PREFIX)) {
    kind = "user";
    code = id.slice(USER_PREFIX.length);
  } else if (id.startsWith(COMMERCE_PREFIX)) {
    kind = "commerce";
    code = id.slice(COMMERCE_PREFIX.length);
  } else {
    return null;
  }
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) return null;
  return { code, kind };
}

export function normalizePhoneDigits(phone: string): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  const last9 = d.length >= 9 ? d.slice(-9) : d;
  if (!/^6\d{8}$/.test(last9)) return null;
  return last9;
}

/** Octets manufacturer (sans company ID) — tient dans une pub BLE 31 octets. */
export function encodeBleTaxiManufBytes(input: {
  accountId: string;
  phone: string;
}): number[] | null {
  const parsed = accountIdToCode(input.accountId);
  const phone = normalizePhoneDigits(input.phone);
  if (!parsed || !phone) return null;
  const magic1 = parsed.kind === "commerce" ? MAGIC_COMMERCE : MAGIC_USER;
  const bytes: number[] = [MAGIC0, magic1];
  for (let i = 0; i < CODE_LEN; i++) bytes.push(parsed.code.charCodeAt(i));
  for (let i = 0; i < PHONE_LEN; i++) bytes.push(phone.charCodeAt(i));
  return bytes;
}

function readAscii(bytes: Uint8Array | number[], start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const b = bytes[start + i];
    if (b == null || b < 0x20 || b > 0x7e) return "";
    s += String.fromCharCode(b);
  }
  return s;
}

function peerFromCodePhone(
  code: string,
  phoneDigits: string,
  rssi: number | null,
  kind: AccountKind = "user",
): Omit<BleTaxiPeer, "lastSeenAt"> | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) return null;
  if (!/^6\d{8}$/.test(phoneDigits)) return null;
  const tag = code.slice(-4);
  return {
    accountId: codeToAccountId(code, kind),
    phoneDigits,
    displayName: kind === "commerce" ? `Pro ${tag}` : `Taxi ${tag}`,
    rssi: rssi ?? -100,
  };
}

function decodeBinaryPayload(
  bytes: Uint8Array | number[],
  offset: number,
  rssi: number | null,
): Omit<BleTaxiPeer, "lastSeenAt"> | null {
  if (bytes.length - offset < BINARY_LEN) return null;
  if (bytes[offset] !== MAGIC0) return null;
  const m1 = bytes[offset + 1];
  let kind: AccountKind | null = null;
  if (m1 === MAGIC_USER) kind = "user";
  else if (m1 === MAGIC_COMMERCE) kind = "commerce";
  else return null;
  const code = readAscii(bytes, offset + 2, CODE_LEN);
  const phone = readAscii(bytes, offset + 2 + CODE_LEN, PHONE_LEN);
  return peerFromCodePhone(code, phone, rssi, kind);
}

/** AD 0x08 / 0x09 = local name. */
export function extractNameFromScanRecord(
  rawScanRecordBase64: string | null | undefined,
): string | null {
  const raw = rawScanRecordBase64
    ? base64ToBytes(rawScanRecordBase64)
    : null;
  if (!raw || raw.length < 3) return null;

  let i = 0;
  while (i < raw.length) {
    const len = raw[i]!;
    if (len === 0) break;
    if (i + 1 + len > raw.length) break;
    const type = raw[i + 1]!;
    if (type === 0x08 || type === 0x09) {
      const data = raw.subarray(i + 2, i + 1 + len);
      let s = "";
      for (let j = 0; j < data.length; j++) {
        const c = data[j]!;
        if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
      }
      if (s) return s;
    }
    i += len + 1;
  }
  return null;
}

function asciiFromBytes(bytes: Uint8Array | number[], start = 0): string {
  let s = "";
  for (let i = start; i < bytes.length; i++) {
    const c = bytes[i]!;
    if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
  }
  return s.trim();
}

export function parseBleTaxiName(
  localName: string | null | undefined,
  rssi: number | null,
): Omit<BleTaxiPeer, "lastSeenAt"> | null {
  const raw = String(localName ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (!upper.includes(BLYP_BLE_NAME_PREFIX)) return null;

  const idx = upper.indexOf(BLYP_BLE_NAME_PREFIX);
  const fromBlyp = raw.slice(idx);
  const rest = fromBlyp.slice(BLYP_BLE_NAME_PREFIX.length).trim();

  if (!rest || rest === "-" || rest === "_") {
    return {
      accountId: BLYP_BLE_DEMO_ACCOUNT_ID,
      phoneDigits: BLYP_BLE_DEMO_PHONE,
      displayName: "Taxi",
      rssi: rssi ?? -100,
    };
  }

  const parts = rest.replace(/^[|:\-\s]+/, "").split(/[|:\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    const rawCode = parts[0]!.toUpperCase();
    let kind: AccountKind = "user";
    let code = rawCode;
    if (rawCode.startsWith("BLYP-C-")) {
      kind = "commerce";
      code = rawCode.slice(COMMERCE_PREFIX.length);
    } else if (rawCode.startsWith("BLYP-U-")) {
      code = rawCode.slice(USER_PREFIX.length);
    } else if (rawCode.startsWith("C-")) {
      kind = "commerce";
      code = rawCode.slice(2);
    } else if (rawCode.startsWith("U-")) {
      code = rawCode.slice(2);
    }
    const phone = parts[1]!.replace(/\D/g, "").slice(-9);
    const hit = peerFromCodePhone(code, phone, rssi, kind);
    if (hit) return hit;
  }

  return {
    accountId: BLYP_BLE_DEMO_ACCOUNT_ID,
    phoneDigits: BLYP_BLE_DEMO_PHONE,
    displayName: "Taxi",
    rssi: rssi ?? -100,
  };
}

function parseManufacturerBase64(
  manufacturerData: string | null | undefined,
  rssi: number | null,
): Omit<BleTaxiPeer, "lastSeenAt"> | null {
  if (!manufacturerData) return null;
  const raw = base64ToBytes(manufacturerData);
  if (!raw || raw.length < 4) return null;

  let offset = 0;
  if (raw.length >= 2) {
    const companyLe = raw[0]! | (raw[1]! << 8);
    const companyBe = (raw[0]! << 8) | raw[1]!;
    if (
      companyLe === BLYP_BLE_COMPANY_ID ||
      companyBe === BLYP_BLE_COMPANY_ID
    ) {
      offset = 2;
    }
  }

  const binary = decodeBinaryPayload(raw, offset, rssi);
  if (binary) return binary;

  const ascii = asciiFromBytes(raw, offset);
  const m = ascii.match(/BLYP(?:\|[0-9A-HJKMNP-TV-Z]{10}\|\d{9})?/i);
  return parseBleTaxiName(m ? m[0]! : ascii, rssi);
}

export function resolveTaxiFromScan(device: {
  localName?: string | null;
  name?: string | null;
  manufacturerData?: string | null;
  rawScanRecord?: string | null;
  serviceUUIDs?: string[] | null;
  rssi: number | null;
}): Omit<BleTaxiPeer, "lastSeenAt"> | null {
  const direct =
    parseBleTaxiName(device.localName, device.rssi) ||
    parseBleTaxiName(device.name, device.rssi);
  if (direct) return direct;

  const manuf = parseManufacturerBase64(device.manufacturerData, device.rssi);
  if (manuf) return manuf;

  const fromAd = extractNameFromScanRecord(device.rawScanRecord);
  const named = parseBleTaxiName(fromAd, device.rssi);
  if (named) return named;

  if (device.rawScanRecord) {
    const raw = base64ToBytes(device.rawScanRecord);
    if (raw) {
      for (let i = 0; i + BINARY_LEN <= raw.length; i++) {
        const hit = decodeBinaryPayload(raw, i, device.rssi);
        if (hit) return hit;
      }
      const ascii = asciiFromBytes(raw);
      const m = ascii.match(/BLYP(?:\|[0-9A-HJKMNP-TV-Z]{10}\|\d{9})?/i);
      if (m) return parseBleTaxiName(m[0]!, device.rssi);
    }
  }

  return null;
}
