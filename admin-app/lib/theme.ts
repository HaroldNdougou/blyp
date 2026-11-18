export type ThemeColors = {
  accent: string;
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  danger: string;
  money: string;
  onAccent: string;
};

const ACCENT = "#5dc705";

export const lightColors: ThemeColors = {
  accent: ACCENT,
  bg: "#F4F4F5",
  card: "#FFFFFF",
  border: "#E4E4E7",
  text: "#18181B",
  muted: "#71717A",
  danger: "#DC2626",
  money: "#2563EB",
  onAccent: "#0B0B0C",
};

export const darkColors: ThemeColors = {
  accent: ACCENT,
  bg: "#0B0B0C",
  card: "#161618",
  border: "#2A2A2E",
  text: "#F5F5F5",
  muted: "#9CA3AF",
  danger: "#F87171",
  money: "#60A5FA",
  onAccent: "#0B0B0C",
};