import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createPaymentReceiptStyles(c: ThemeColors) {
  return StyleSheet.create({
    successSafe: {
      flex: 1,
      backgroundColor: c.background,
    },
    successScroll: {
      flex: 1,
    },
    successScrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 16,
    },
    successTop: {
      alignItems: "center",
    },
    successIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.depositHighlightBackground,
      borderWidth: 1,
      borderColor: c.depositHighlightBorder,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 18,
    },
    successTitle: {
      color: c.text,
      fontSize: 26,
      fontWeight: "800",
      textAlign: "center",
    },
    successSubtitle: {
      color: c.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 8,
      marginBottom: 22,
      paddingHorizontal: 12,
    },
    successAmount: {
      color: c.accent,
      fontSize: 36,
      fontWeight: "800",
      letterSpacing: -0.5,
      textAlign: "center",
    },
    successAmountCurrency: {
      color: c.textFaint,
      fontSize: 15,
      fontWeight: "700",
      textAlign: "center",
      marginTop: 4,
      marginBottom: 28,
    },
    successReceipt: {
      width: "100%",
      backgroundColor: c.surfaceMuted,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    successRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingVertical: 7,
      gap: 12,
    },
    successRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderLight,
    },
    successRowLabel: {
      flexShrink: 0,
      fontSize: 12,
      fontWeight: "600",
      color: c.textMuted,
      paddingTop: 1,
    },
    successRowValue: {
      flex: 1,
      fontSize: 12,
      fontWeight: "700",
      color: c.text,
      textAlign: "right",
    },
    successRowValueMuted: {
      fontWeight: "600",
      color: c.textSecondary,
    },
    successStatusOk: {
      color: c.accent,
    },
    successHistoryInScroll: {
      width: "100%",
      marginTop: 20,
    },
    successActions: {
      width: "100%",
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 12,
      backgroundColor: c.background,
      alignItems: "center",
    },
    successPrimaryBtn: {
      backgroundColor: c.accent,
      height: 40,
      minWidth: 120,
      paddingHorizontal: 28,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
    },
    successPrimaryBtnPressed: {
      opacity: 0.92,
      transform: [{ scale: 0.99 }],
    },
    successPrimaryBtnText: {
      color: c.accentOn,
      fontSize: 13,
      fontWeight: "700",
      letterSpacing: 0,
    },
    successSecondaryBtn: {
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    successSecondaryBtnPressed: {
      opacity: 0.75,
    },
    successSecondaryBtnText: {
      color: c.text,
      fontSize: 15,
      fontWeight: "700",
    },
  });
}
