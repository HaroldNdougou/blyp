import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createSoaCarHomeStyles(c: ThemeColors) {
  const seatGap = 6;
  return StyleSheet.create({
    safe: { flex: 1 },
    bodySafe: { flex: 1 },
    topBar: {
      position: "absolute",
      top: 0,
      right: 0,
      left: 0,
      zIndex: 2,
      paddingRight: 16,
      paddingLeft: 16,
      alignItems: "flex-end",
    },
    onlineRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 0,
      paddingHorizontal: 12,
      marginRight: -4,
    },
    onlineSwitchWrap: {
      minWidth: 52,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    onlineLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: c.textMuted,
    },
    onlineLabelOn: { color: c.accent },
    body: {
      flex: 1,
      paddingHorizontal: 20,
    },
    tripTotalBlock: {
      alignItems: "center",
      marginBottom: 20,
    },
    tripTotalLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: c.textMuted,
      marginBottom: 6,
    },
    tripTotalAmountRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    tripTotalValue: {
      fontSize: 32,
      fontWeight: "800",
      color: c.text,
    },
    tripTotalCurrency: {
      fontSize: 14,
      fontWeight: "600",
      color: c.textMuted,
    },
    seatMapBlock: {
      gap: seatGap,
      paddingVertical: 8,
      width: "100%",
      alignItems: "center",
    },
    seatRow: {
      flexDirection: "row",
      gap: seatGap,
      width: "100%",
      maxWidth: 288,
      alignSelf: "center",
    },
    seatSlotEmpty: {
      flex: 1,
      aspectRatio: 1,
    },
    seatCellOuter: {
      flex: 1,
      aspectRatio: 1,
      overflow: "visible",
    },
    seatCell: {
      flex: 1,
      position: "relative",
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: c.borderLight,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
    },
    seatPayCountBadge: {
      position: "absolute",
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    seatPayCountBadgeText: {
      fontSize: 9,
      fontWeight: "800",
      color: c.accentOn,
    },
    seatCellPaid: {
      borderColor: c.accent,
      backgroundColor: c.depositHighlightBackground,
    },
    seatCellTaken: {
      opacity: 0.35,
    },
    seatCellSelected: {
      borderColor: c.accent,
      backgroundColor: c.depositHighlightBackground,
    },
    seatNum: {
      fontSize: 15,
      fontWeight: "800",
      color: c.textMuted,
    },
    seatNumPaid: { color: c.accent },
    seatAmt: {
      fontSize: 8,
      fontWeight: "600",
      color: c.textMuted,
      marginTop: 1,
    },
    seatMapFooterSpacer: {
      flexGrow: 1,
      minHeight: 32,
    },
    footer: {
      paddingBottom: 12,
      gap: 10,
    },
    resetBtn: {
      alignSelf: "center",
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.borderLight,
    },
    resetBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: c.text,
    },
    metaLine: {
      fontSize: 9,
      fontWeight: "600",
      color: c.accent,
      textAlign: "center",
    },
    driverHint: {
      fontSize: 11,
      color: c.textMuted,
      textAlign: "center",
      marginBottom: 8,
    },
  });
}

export function createSoaSeatSheetStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: c.modal,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 28,
    },
    title: {
      fontSize: 18,
      fontWeight: "800",
      color: c.text,
      marginBottom: 4,
    },
    sub: {
      fontSize: 13,
      color: c.textMuted,
      marginBottom: 16,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 8,
    },
    seat: {
      width: 44,
      height: 44,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: c.borderLight,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
    },
    seatTaken: {
      opacity: 0.35,
    },
    seatSelected: {
      borderColor: c.accent,
      backgroundColor: c.depositHighlightBackground,
    },
    seatLabel: {
      fontSize: 14,
      fontWeight: "800",
      color: c.text,
    },
    actions: {
      flexDirection: "row",
      gap: 12,
      marginTop: 20,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: c.surface,
    },
    cancelText: {
      fontWeight: "700",
      color: c.textMuted,
    },
    confirmBtn: {
      flex: 1,
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: c.accent,
    },
    confirmText: {
      fontWeight: "800",
      color: c.accentOn,
    },
    confirmDisabled: { opacity: 0.45 },
  });
}
