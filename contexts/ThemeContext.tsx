import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import {
  getStatusBarStyle,
  getThemeColors,
  type ColorScheme,
  type ThemeColors,
} from "@/lib/theme/colors";

export type ThemeContextValue = {
  colors: ThemeColors;
  colorScheme: ColorScheme;
  isDark: boolean;
  statusBarStyle: "light" | "dark" | "auto";
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const colorScheme: ColorScheme = systemScheme === "dark" ? "dark" : "light";

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: getThemeColors(colorScheme),
      colorScheme,
      isDark: colorScheme === "dark",
      statusBarStyle: getStatusBarStyle(colorScheme),
    }),
    [colorScheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
