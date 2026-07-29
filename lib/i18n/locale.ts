import { getLocales } from "expo-localization";

export type AppLanguage = "fr" | "en";

/** FR si la langue système est le français ; sinon EN (repli). */
export function resolveAppLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode?.toLowerCase() ?? "en";
  return code === "fr" ? "fr" : "en";
}

export function getNumberLocale(lang: AppLanguage): string {
  return lang === "fr" ? "fr-FR" : "en-US";
}
