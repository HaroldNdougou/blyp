/**
 * Couleurs du splash natif (app.json / expo-splash-screen).
 * Doivent rester synchrones avec les assets générés (`npm run splash:generate`).
 */
import { darkColors, lightColors } from "@/lib/theme/colors";

/** Fond splash mode clair — blanc + marque verte. */
export const SPLASH_BACKGROUND_LIGHT = lightColors.background;

/** Fond splash mode sombre — même noir que l’app (transition nette). */
export const SPLASH_BACKGROUND_DARK = darkColors.background;

export function getSplashBackground(
  scheme: "light" | "dark" | null | undefined,
): string {
  return scheme === "dark" ? SPLASH_BACKGROUND_DARK : SPLASH_BACKGROUND_LIGHT;
}
