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

export { formatFcfa } from "./formatFcfa";

import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";

function currentNumberLocale(): string {
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  return getNumberLocale(lang);
}

/** Fenêtre « Maintenant » pour la dernière réception (accueil commerce). */
export const JUST_NOW_WINDOW_MS = 30_000;

/** True si `iso` est dans la fenêtre « juste reçu » (tolérance horloge ~2s). */
export function isTransactionJustNow(
  iso: string,
  nowMs: number = Date.now(),
): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= -2000 && age <= JUST_NOW_WINDOW_MS;
}

/** ms restantes avant fin de « Maintenant », ou null si déjà expiré. */
export function msUntilJustNowExpires(
  iso: string,
  nowMs: number = Date.now(),
): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const remaining = JUST_NOW_WINDOW_MS - (nowMs - t);
  return remaining > 0 ? remaining : null;
}

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(currentNumberLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Clé jour local — séparateurs de fil. */
export function messageDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Pastille WhatsApp : Aujourd’hui / Hier / jour de la semaine / date. */
export function formatMessageDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(d)) / 86_400_000,
  );
  if (diffDays === 0) return i18n.t("dates.today");
  if (diffDays === 1) return i18n.t("dates.yesterday");
  const locale = currentNumberLocale();
  if (diffDays > 1 && diffDays < 7) {
    const weekday = d.toLocaleDateString(locale, { weekday: "long" });
    return weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : "";
  }
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** Message Money en attente : « 12 oct. » / « Oct 12, 2026 » si autre année. */
export function formatMoneyExpiresDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const locale = currentNumberLocale();
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** Liste des discussions : heure / Hier / date courte. */
export function formatConversationWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(d)) / 86_400_000,
  );
  if (diffDays === 0) return formatMessageTime(iso);
  if (diffDays === 1) return i18n.t("dates.yesterday");
  const locale = currentNumberLocale();
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
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
  const locale = currentNumberLocale();
  const time = d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return i18n.t("dates.todayAt", { time });
  if (isYesterday) return i18n.t("dates.yesterdayAt", { time });
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** Taille fichier pour bulles document (octets → Ko / Mo). */
export function formatFileSize(bytes: number): string {
  const n = Math.max(0, Math.floor(Number(bytes) || 0));
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

