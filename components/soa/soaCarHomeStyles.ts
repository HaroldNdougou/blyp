import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

type SoaCarHomeStyleOpts = {
  /** Grille sièges réduite (modal compte rendu). */
  seatMapCompact?: boolean;
};

export function createSoaCarHomeStyles(
  c: ThemeColors,
  opts?: SoaCarHomeStyleOpts,
) {
  const compact = opts?.seatMapCompact === true;
  const seatGap = compact ? 4 : 6;
  const seatRowMaxWidth = compact ? 204 : 288;
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
      paddingVertical: compact ? 4 : 8,
      width: "100%",
      alignItems: "center",
    },
    seatRow: {
      flexDirection: "row",
      gap: seatGap,
      width: "100%",
      maxWidth: seatRowMaxWidth,
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
      borderRadius: compact ? 7 : 10,
      borderWidth: compact ? 1 : 1.5,
      borderColor: c.borderLight,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
    },
    seatPayCountBadge: {
      position: "absolute",
      top: compact ? -3 : -4,
      right: compact ? -3 : -4,
      minWidth: compact ? 14 : 18,
      height: compact ? 14 : 18,
      paddingHorizontal: compact ? 3 : 4,
      borderRadius: compact ? 7 : 9,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    seatPayCountBadgeText: {
      fontSize: compact ? 7 : 9,
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
      fontSize: compact ? 11 : 15,
      fontWeight: "800",
      color: c.textMuted,
    },
    seatNumPaid: { color: c.accent },
    seatAmt: {
      fontSize: compact ? 6 : 8,
      fontWeight: "600",
      color: c.textMuted,
      marginTop: compact ? 0 : 1,
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

export function createSoaReportStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    daySelectHost: {
      width: "100%",
      alignItems: "center",
      zIndex: 50,
      elevation: 50,
      overflow: "visible",
      paddingTop: 8,
      paddingBottom: 4,
    },
    daySelectWrap: {
      position: "relative",
      alignSelf: "center",
      minWidth: 260,
      maxWidth: "92%",
      overflow: "visible",
    },
    daySelect: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      backgroundColor: c.surface,
    },
    daySelectText: {
      fontSize: 16,
      fontWeight: "500",
      color: c.text,
    },
    dayDropdown: {
      position: "absolute",
      left: 0,
      right: 0,
      width: "100%",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      borderRadius: 10,
      backgroundColor: c.surface,
      overflow: "hidden",
      zIndex: 51,
      elevation: 51,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.14,
      shadowRadius: 10,
    },
    dayDropdownScroll: {
      maxHeight: 220,
    },
    dayPickerRow: {
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    dayPickerRowActive: {
      backgroundColor: c.background,
    },
    dayPickerRowText: {
      fontSize: 15,
      fontWeight: "500",
      color: c.text,
    },
    dayPickerRowTextActive: {
      fontWeight: "600",
      color: c.accentDark,
    },
    summaryBlock: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 20,
      gap: 18,
      alignItems: "center",
      zIndex: 1,
    },
    summaryStat: {
      gap: 6,
      alignItems: "center",
      width: "100%",
    },
    summaryLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: c.textMuted,
      textAlign: "center",
    },
    summaryAmountRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "center",
      gap: 4,
    },
    summaryAmountValue: {
      fontSize: 32,
      fontWeight: "800",
      color: c.text,
      fontVariant: ["tabular-nums"],
    },
    summaryAmountCurrency: {
      fontSize: 15,
      fontWeight: "700",
      color: c.text,
    },
    summaryTrendHit: {
      marginLeft: 4,
      marginBottom: 2,
      padding: 2,
    },
    summaryTrendIcon: {},
    summaryAmountRowWrap: {
      alignItems: "center",
      gap: 8,
    },
    trendPill: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: c.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      maxWidth: "92%",
    },
    trendPillRateUp: {
      fontSize: 13,
      fontWeight: "800",
      color: c.accent,
    },
    trendPillRateDown: {
      fontSize: 13,
      fontWeight: "800",
      color: c.destructive,
    },
    trendPillCompare: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textMuted,
    },
    trendDismissScrim: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 40,
    },
    summaryAmountRowWrapElevated: {
      zIndex: 45,
    },
    summaryCountValue: {
      fontSize: 32,
      fontWeight: "800",
      color: c.text,
      fontVariant: ["tabular-nums"],
      textAlign: "center",
    },
    coursesEntry: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    coursesEntryPressed: {
      opacity: 0.75,
    },
    coursesEntryLabel: {
      fontSize: 11,
      fontWeight: "800",
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    tripListSheet: {
      maxHeight: "78%",
    },
    tripListSheetTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: c.textMuted,
      marginBottom: 2,
      textAlign: "center",
      alignSelf: "stretch",
    },
    tripListSheetDay: {
      fontSize: 12,
      fontWeight: "500",
      color: c.textFaint,
      textAlign: "center",
      alignSelf: "stretch",
      marginBottom: 12,
    },
    tripListSheetScroll: {
      maxHeight: 420,
    },
    tripListSheetScrollContent: {
      paddingBottom: 8,
    },
    list: { flex: 1, paddingHorizontal: 16 },
    listSectionHeader: {
      paddingTop: 4,
      paddingBottom: 10,
      alignItems: "center",
    },
    listSectionTitle: {
      fontSize: 11,
      fontWeight: "800",
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      textAlign: "center",
    },
    tripRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderLight,
    },
    tripTitleRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minWidth: 0,
    },
    tripTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: "500",
      color: c.text,
    },
    tripTitleActive: {
      fontWeight: "500",
      color: c.accentDark,
    },
    tripActivePulseDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.accent,
    },
    tripAmount: {
      fontSize: 16,
      fontWeight: "500",
      color: c.successAmount,
      fontVariant: ["tabular-nums"],
    },
    tripAmountCurrency: {
      fontSize: 13,
      fontWeight: "500",
      color: c.successAmount,
    },
    empty: {
      paddingVertical: 32,
      alignItems: "center",
    },
    emptyText: {
      fontSize: 15,
      color: c.textMuted,
      textAlign: "center",
    },
  });
}

export function createSoaTripDetailSheetStyles(c: ThemeColors) {
  const base = createSoaSeatSheetStyles(c);
  const extra = StyleSheet.create({
    sheetTall: {
      maxHeight: "85%",
    },
    detailSheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 2,
      minHeight: 36,
    },
    detailSheetBackBtn: {
      padding: 6,
      marginLeft: -6,
    },
    detailSheetHeaderTitle: {
      flex: 1,
      textAlign: "center",
      marginBottom: 0,
    },
    detailSheetHeaderSpacer: {
      width: 36,
    },
    detailSheetSub: {
      textAlign: "center",
      alignSelf: "stretch",
    },
    seatMapSection: {
      marginBottom: 10,
    },
    paymentsListTitle: {
      fontSize: 11,
      fontWeight: "800",
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    scroll: {
      maxHeight: 260,
    },
    scrollContent: {
      paddingBottom: 4,
    },
    paymentRow: {
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderLight,
      gap: 4,
    },
    paymentRowTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    paymentPayerName: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: c.text,
    },
    paymentAmount: {
      fontSize: 13,
      fontWeight: "600",
      color: c.textMuted,
      fontVariant: ["tabular-nums"],
    },
    paymentMeta: {
      fontSize: 11,
      fontWeight: "500",
      color: c.textMuted,
    },
    paymentPhone: {
      fontSize: 11,
      fontWeight: "500",
      color: c.textFaint,
    },
    emptyPayments: {
      paddingVertical: 24,
      alignItems: "center",
    },
    emptyPaymentsText: {
      fontSize: 14,
      color: c.textMuted,
      textAlign: "center",
    },
  });
  return { ...base, ...extra, sheet: [base.sheet, extra.sheetTall] };
}
