import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createIncomingFlashStyles(c: ThemeColors) {
  return StyleSheet.create({
    flashOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 40,
      elevation: 24,
      justifyContent: "flex-end",
    },
    flashBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    flashSheet: {
      backgroundColor: c.modal,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      paddingHorizontal: 24,
      paddingTop: 22,
      alignItems: "center",
    },
    flashTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: c.textMuted,
      textAlign: "center",
    },
    flashAmount: {
      marginTop: 10,
      fontSize: 64,
      fontWeight: "800",
      color: c.accent,
      letterSpacing: -1.5,
      textAlign: "center",
      width: "100%",
      fontVariant: ["tabular-nums"],
    },
    flashCurrency: {
      marginTop: 2,
      marginBottom: 8,
      fontSize: 16,
      fontWeight: "700",
      color: c.accent,
      textAlign: "center",
    },
  });
}
