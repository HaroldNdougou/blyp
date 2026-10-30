import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createBlypActionFlashStyles(c: ThemeColors) {
  return StyleSheet.create({
    host: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      zIndex: 200,
      elevation: 32,
      alignItems: "center",
      pointerEvents: "box-none",
    },
    pill: {
      maxWidth: "92%",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 11,
      paddingHorizontal: 16,
      borderRadius: 999,
      backgroundColor: c.depositHighlightBackground,
      borderWidth: 1,
      borderColor: c.depositHighlightBorder,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 6,
    },
    pillPressed: {
      opacity: 0.92,
    },
    pillText: {
      flexShrink: 1,
      fontSize: 14,
      fontWeight: "700",
      color: c.accent,
      textAlign: "center",
    },
  });
}
