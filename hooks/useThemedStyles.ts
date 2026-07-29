import { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/lib/theme/colors";

/** Styles memoïsés selon le thème système (clair / sombre). */
export function useThemedStyles<T>(
  factory: (colors: ThemeColors) => T,
  deps: readonly unknown[] = [],
): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory, ...deps]);
}
