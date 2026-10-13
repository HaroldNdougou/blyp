import { getLocales } from "expo-localization";

const CALLING_BY_REGION: Record<string, string> = {
  CM: "237",
  FR: "33",
  US: "1",
  GB: "44",
  BE: "32",
  CH: "41",
  DE: "49",
  SN: "221",
  CI: "225",
  GA: "241",
  CG: "242",
  CD: "243",
  NG: "234",
};

export function defaultCallingCode(): string {
  const region = getLocales()[0]?.regionCode?.toUpperCase() ?? "CM";
  return CALLING_BY_REGION[region] ?? "237";
}

/** Numéro répertoire / saisie → E.164 (+…), messagerie internationale. */
export function normalizeContactPhoneE164(
  raw: string,
  defaultCallingCodeOverride?: string,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  let digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.startsWith("00") && digits.length > 4) {
    digits = digits.slice(2);
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const calling = defaultCallingCodeOverride ?? defaultCallingCode();

  if (calling === "237") {
    if (digits.startsWith("237") && digits.length >= 12) {
      const nine = digits.slice(-9);
      if (/^6\d{8}$/.test(nine)) return `+237${nine}`;
    }
    if (digits.length === 10 && digits.startsWith("0")) {
      digits = digits.slice(1);
    }
    if (digits.length === 9 && digits[0] === "6") {
      return `+237${digits}`;
    }
  }

  if (digits.startsWith("0") && digits.length >= 9) {
    const national = digits.slice(1);
    if (national.length >= 8 && national.length <= 12) {
      return `+${calling}${national}`;
    }
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

export function isValidPeerPhoneE164(e164: string): boolean {
  return /^\+\d{8,15}$/.test(e164);
}

export function cameroonNineFromE164(e164: string | null | undefined): string | null {
  if (!e164?.startsWith("+237")) return null;
  const nine = e164.slice(4);
  return /^6\d{8}$/.test(nine) ? nine : null;
}

export function formatPeerPhoneDisplay(e164: string): string {
  if (!e164.startsWith("+")) return e164;
  const nine = cameroonNineFromE164(e164);
  if (nine) {
    const { formatCameroonPhoneDisplay } = require("@/lib/format") as {
      formatCameroonPhoneDisplay: (d: string) => string;
    };
    return `+237 ${formatCameroonPhoneDisplay(nine)}`;
  }
  const cc = e164.slice(1, 4);
  const rest = e164.slice(4);
  return `+${cc} ${rest}`;
}

/** wa.me : chiffres internationaux sans + */
export function e164ToWhatsAppDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
