/** Chiffres uniquement, max 9 (mobile CM après +237). */
export function normalizeCameroonPhoneDigits(raw: string): string {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, 9);
}

/** Marque mobile money déduite du préfixe national (9 chiffres commençant par 6). */
export type CameroonMobileMoneyBrand = "orange" | "mtn";

/**
 * Orange Money / MTN MoMo à partir des préfixes courants au Cameroun (après passage au format 6…).
 * Nexttel (66…) → null. Indicatif : 69…, 640…, 686…, 655–659 Orange ; 67…, 680–685, 687–689, 650–654 MTN.
 */
export function inferCameroonMobileMoneyBrand(
  digits: string,
): CameroonMobileMoneyBrand | null {
  const d = normalizeCameroonPhoneDigits(digits);
  if (d.length < 2 || d[0] !== "6") return null;

  if (d.startsWith("69")) return "orange";

  if (d.startsWith("64")) {
    if (d.length < 3) return null;
    if (d.startsWith("640")) return "orange";
  }

  if (d.startsWith("68")) {
    if (d.length < 3) return null;
    if (d.startsWith("686")) return "orange";
    return "mtn";
  }

  if (d.startsWith("67")) return "mtn";

  if (d.startsWith("65")) {
    if (d.length < 3) return null;
    const third = d.charCodeAt(2) - 48;
    if (third >= 0 && third <= 4) return "mtn";
    if (third >= 5 && third <= 9) return "orange";
  }

  if (d.startsWith("66")) return null;

  return null;
}

/** Affichage type « 6 12 34 56 78 » à partir des 9 chiffres max. */
export function formatCameroonPhoneDisplay(digits: string): string {
  const d = normalizeCameroonPhoneDigits(digits);
  if (d.length === 0) return "";
  const head = d[0];
  const rest = d.slice(1);
  const parts: string[] = [head];
  for (let i = 0; i < rest.length; i += 2) {
    parts.push(rest.slice(i, i + 2));
  }
  return parts.join(" ");
}

/** Affichage montant FCFA type "12 500" */
export function formatFcfa(amount: number): string {
  return Math.max(0, Math.floor(amount)).toLocaleString("fr-FR");
}

export function formatTransactionDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `Aujourd'hui, ${time}`;
  if (isYesterday) return `Hier, ${time}`;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
