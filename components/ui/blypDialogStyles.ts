import { StyleSheet } from "react-native";
import type { ThemeColors } from "@/lib/theme/colors";

/** Popups centrés (confirmations, alertes) — source unique pour toute l’app. */
export function createBlypDialogStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 28,
    },
    wrap: {
      width: "100%",
      maxWidth: 320,
    },
    card: {
      backgroundColor: c.modal,
      borderRadius: 20,
      paddingHorizontal: 22,
      paddingTop: 22,
      paddingBottom: 18,
      borderWidth: 1,
      borderColor: c.borderLight,
      elevation: 8,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.22,
      shadowRadius: 12,
    },
    iconWrap: {
      alignSelf: "center",
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.inputBackground,
      borderWidth: 1,
      borderColor: c.inputBorder,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
      textAlign: "center",
      marginBottom: 8,
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
      color: c.textMuted,
      textAlign: "center",
      marginBottom: 20,
    },
    actions: {
      gap: 10,
    },
    btnSecondary: {
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.inputBackground,
      borderWidth: 1,
      borderColor: c.inputBorder,
    },
    btnSecondaryPressed: {
      opacity: 0.88,
    },
    btnSecondaryText: {
      fontSize: 15,
      fontWeight: "600",
      color: c.text,
    },
    btnPrimary: {
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
    },
    btnPrimaryPressed: {
      opacity: 0.92,
    },
    btnPrimaryText: {
      fontSize: 15,
      fontWeight: "700",
      color: c.textInverse,
    },
    btnDestructive: {
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.signOutBackground,
      borderWidth: 1,
      borderColor: c.signOutBorder,
    },
    btnDestructivePressed: {
      opacity: 0.9,
    },
    btnDestructiveDisabled: {
      opacity: 0.65,
    },
    btnDestructiveText: {
      fontSize: 15,
      fontWeight: "700",
      color: c.destructive,
    },
  });
}

export type BlypDialogStyles = ReturnType<typeof createBlypDialogStyles>;
