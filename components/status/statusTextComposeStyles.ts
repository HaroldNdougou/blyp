import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createStatusTextComposeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 8,
    },
    topBarRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    chromeCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.overlay,
      alignItems: "center",
      justifyContent: "center",
    },
    textArea: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 28,
    },
    bottomDock: {
      position: "absolute",
      left: 0,
      right: 0,
    },
    textInput: {
      color: c.textInverse,
      textAlign: "center",
      paddingVertical: 8,
    },
    mentionFab: {
      alignSelf: "flex-end",
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.overlay,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
      marginRight: 12,
    },
    footerBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.statusTextFooterBar,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.borderLight,
    },
    audiencePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: c.surfaceMuted,
      maxWidth: "72%",
    },
    audienceLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: c.text,
    },
    sendButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonDisabled: {
      backgroundColor: c.disabledButton,
    },
  });
}
