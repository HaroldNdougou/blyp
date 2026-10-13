/** Accepte le numéro saisi après +237 (ex. 6XXXXXXXX). */
export function normalizeCameroonPhone(raw) {
  const d = String(raw ?? "")
    .trim()
    .replace(/\D/g, "");
  if (d.length < 9) return null;
  const last9 = d.slice(-9);
  if (!/^6\d{8}$/.test(last9)) return null;
  return `+237${last9}`;
}

/** Messagerie : E.164 (+…). CM 6… par défaut si format national. */
export function normalizePeerPhoneE164(raw, defaultCallingCode = "237") {
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

  const cm = normalizeCameroonPhone(s);
  if (cm) return cm;

  if (defaultCallingCode === "237") {
    if (digits.length === 10 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 9 && digits[0] === "6") return `+237${digits}`;
  }

  if (digits.startsWith("0") && digits.length >= 9) {
    const national = digits.slice(1);
    if (national.length >= 8 && national.length <= 12) {
      return `+${defaultCallingCode}${national}`;
    }
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}
