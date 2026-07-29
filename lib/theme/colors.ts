/** Tokens couleur Blyp — base clair/sombre (extensible rose/gold/skins plus tard). */

export type ColorScheme = "light" | "dark";

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  textInverse: string;
  border: string;
  borderLight: string;
  accent: string;
  accentDark: string;
  accentOn: string;
  destructive: string;
  destructiveSoft: string;
  destructiveBorder: string;
  overlay: string;
  modal: string;
  inputBackground: string;
  inputBorder: string;
  inputErrorBackground: string;
  inputErrorBorder: string;
  placeholder: string;
  tabBar: string;
  tabBarBorder: string;
  tabInactive: string;
  keypadBackground: string;
  keypadBackgroundFn: string;
  keypadBorder: string;
  keypadPressed: string;
  keypadIcon: string;
  keypadText: string;
  avatarBackground: string;
  avatarText: string;
  successAmount: string;
  sentAmount: string;
  disabled: string;
  disabledButton: string;
  shadow: string;
  signOutBackground: string;
  signOutBorder: string;
  depositHighlightBackground: string;
  depositHighlightBorder: string;
};

const accent = "#5dc705";
const accentDark = "#4bb004";

export const lightColors: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F5F5F5",
  text: "#222222",
  textSecondary: "#666666",
  textMuted: "#888888",
  textFaint: "#AAAAAA",
  textInverse: "#FFFFFF",
  border: "#EEEEEE",
  borderLight: "#F0F0F0",
  accent,
  accentDark,
  accentOn: "#FFFFFF",
  destructive: "#C62828",
  destructiveSoft: "#FFF8F8",
  destructiveBorder: "#FFCDD2",
  overlay: "rgba(0,0,0,0.5)",
  modal: "#FFFFFF",
  inputBackground: "#F8F8F8",
  inputBorder: "#EEEEEE",
  inputErrorBackground: "#FFF5F5",
  inputErrorBorder: "rgba(198, 40, 40, 0.45)",
  placeholder: "#CCCCCC",
  tabBar: "#FFFFFF",
  tabBarBorder: "#F0F0F0",
  tabInactive: "#8E8E93",
  keypadBackground: "#F3F3F3",
  keypadBackgroundFn: "#EEEEEE",
  keypadBorder: "#E8E8E8",
  keypadPressed: "#E0E0E0",
  keypadIcon: "#555555",
  keypadText: "#222222",
  avatarBackground: "#F0F4F2",
  avatarText: "#4CAF50",
  successAmount: "#4CAF50",
  sentAmount: "#000000",
  disabled: "#CCCCCC",
  disabledButton: "#CCCCCC",
  shadow: "#000000",
  signOutBackground: "#FFF8F8",
  signOutBorder: "#FFCDD2",
  depositHighlightBackground: "#F4FFF0",
  depositHighlightBorder: "#E0F5D5",
};

export const darkColors: ThemeColors = {
  background: "#0B0B0C",
  surface: "#141416",
  surfaceMuted: "#1C1C1E",
  text: "#F5F5F7",
  textSecondary: "#AEAEB2",
  textMuted: "#8E8E93",
  textFaint: "#636366",
  textInverse: "#FFFFFF",
  border: "#2C2C2E",
  borderLight: "#252528",
  accent,
  accentDark,
  accentOn: "#FFFFFF",
  destructive: "#FF6B6B",
  destructiveSoft: "#2A1518",
  destructiveBorder: "#5C2B32",
  overlay: "rgba(0,0,0,0.72)",
  modal: "#1C1C1E",
  inputBackground: "#2C2C2E",
  inputBorder: "#3A3A3C",
  inputErrorBackground: "#2A1518",
  inputErrorBorder: "rgba(255, 107, 107, 0.45)",
  placeholder: "#636366",
  tabBar: "#141416",
  tabBarBorder: "#2C2C2E",
  tabInactive: "#8E8E93",
  keypadBackground: "#2C2C2E",
  keypadBackgroundFn: "#252528",
  keypadBorder: "#3A3A3C",
  keypadPressed: "#3A3A3C",
  keypadIcon: "#AEAEB2",
  keypadText: "#F5F5F7",
  avatarBackground: "#1E2A22",
  avatarText: "#5dc705",
  successAmount: "#5dc705",
  sentAmount: "#F5F5F7",
  disabled: "#48484A",
  disabledButton: "#48484A",
  shadow: "#000000",
  signOutBackground: "#2A1518",
  signOutBorder: "#5C2B32",
  depositHighlightBackground: "#152016",
  depositHighlightBorder: "#2A4030",
};

export function getThemeColors(scheme: ColorScheme | null | undefined): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}

export function getStatusBarStyle(
  scheme: ColorScheme | null | undefined,
): "light" | "dark" | "auto" {
  return scheme === "dark" ? "light" : "dark";
}
