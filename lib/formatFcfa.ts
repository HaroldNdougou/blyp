import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";

function currentNumberLocale(): string {
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  return getNumberLocale(lang);
}

/** Affichage montant FCFA type "12 500" / "12,500" */
export function formatFcfa(amount: number): string {
  return Math.max(0, Math.floor(amount)).toLocaleString(currentNumberLocale());
}
