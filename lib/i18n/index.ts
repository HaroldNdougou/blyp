import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import fr from "./locales/fr";
import { resolveAppLanguage, type AppLanguage } from "./locale";

const appLanguage: AppLanguage = resolveAppLanguage();

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    lng: appLanguage,
    fallbackLng: "en",
    supportedLngs: ["fr", "en"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    compatibilityJSON: "v4",
  });
} else {
  // HMR : nouvelles clés locales (ex. dates.now) sans redémarrage complet.
  i18n.addResourceBundle("fr", "translation", fr, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}

export default i18n;
export { appLanguage, resolveAppLanguage, getNumberLocale } from "./locale";
export type { AppLanguage } from "./locale";
