import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createStatusCreateStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 6,
      minHeight: 48,
    },
    headerSide: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      flex: 1,
      textAlign: "center",
      fontSize: 17,
      fontWeight: "700",
      color: c.text,
    },
    publishLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: c.accent,
    },
    publishLabelDisabled: {
      color: c.placeholder,
    },
    actionRow: {
      flexDirection: "row",
      justifyContent: "space-around",
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 20,
    },
    actionItem: {
      alignItems: "center",
      maxWidth: 88,
    },
    actionCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    actionLabel: {
      marginTop: 8,
      fontSize: 12,
      fontWeight: "500",
      color: c.text,
      textAlign: "center",
    },
    recentsRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 10,
      gap: 4,
    },
    recentsLabel: {
      fontSize: 15,
      fontWeight: "600",
      color: c.text,
    },
    gridCell: {
      backgroundColor: c.surfaceMuted,
      overflow: "hidden",
    },
    cameraCell: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceMuted,
    },
    cameraLabel: {
      marginTop: 6,
      fontSize: 12,
      color: c.textMuted,
    },
    galleryFab: {
      position: "absolute",
      right: 16,
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: c.modal,
      alignItems: "center",
      justifyContent: "center",
      elevation: 6,
      shadowColor: c.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
    },
    listWrap: {
      flex: 1,
    },
    recentsEmptyWrap: {
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    recentsEmptyHint: {
      fontSize: 13,
      lineHeight: 18,
      color: c.textMuted,
      marginBottom: 8,
    },
    recentsEnable: {
      fontSize: 14,
      fontWeight: "700",
      color: c.accent,
    },
    composePreview: {
      flex: 1,
      marginHorizontal: 16,
      marginTop: 8,
      borderRadius: 12,
      overflow: "hidden",
      backgroundColor: c.surfaceMuted,
    },
    composeField: {
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 16,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      backgroundColor: c.surfaceMuted,
      color: c.text,
      minHeight: 80,
      textAlignVertical: "top",
    },
  });
}
