import { getLocales } from "expo-localization";

/** Code langue AWS Translate (cible) depuis la locale système du téléphone. */
export function resolveTranslateTargetLanguage(): string {
  const loc = getLocales()[0];
  const code = String(loc?.languageCode ?? "en").toLowerCase();
  const region = String(loc?.regionCode ?? "").toUpperCase();

  if (code === "zh") {
    return region === "TW" || region === "HK" ? "zh-TW" : "zh";
  }
  if (code === "pt") return region === "BR" ? "pt" : "pt-PT";
  if (code === "en") return "en";
  if (code === "fr") return "fr";
  if (code === "es") return "es";
  if (code === "de") return "de";
  if (code === "ar") return "ar";
  if (code === "hi") return "hi";
  if (code === "ja") return "ja";
  if (code === "ko") return "ko";
  if (code === "ru") return "ru";
  if (code === "it") return "it";
  if (code === "nl") return "nl";
  if (code === "tr") return "tr";
  if (code === "vi") return "vi";
  if (code === "sw") return "sw";

  return code.length >= 2 ? code : "en";
}
