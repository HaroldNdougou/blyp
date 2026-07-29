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
