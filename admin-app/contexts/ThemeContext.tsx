import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { darkColors, lightColors, type ThemeColors } from "../lib/theme";

type ThemeContextValue = {
  colors: ThemeColors;
  isDark: boolean;
  statusBarStyle: "light" | "dark";
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme !== "light";
  const colors = isDark ? darkColors : lightColors;
  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      isDark,
      statusBarStyle: isDark ? "light" : "dark",
    }),
    [colors, isDark],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}