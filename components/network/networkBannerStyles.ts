import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createNetworkBannerStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      alignItems: "center",
      justifyContent: "flex-end",
      paddingBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    text: {
      fontSize: 13,
      fontWeight: "600",
      textAlign: "center",
      color: c.textSecondary,
    },
  });
}
