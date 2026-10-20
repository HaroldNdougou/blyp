import type { ThemeColors } from "@/lib/theme/colors";
import { StyleSheet } from "react-native";

export function createVoiceRecordComposerStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 4,
      gap: 10,
      minHeight: 88,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 32,
      gap: 6,
    },
    topTime: {
      fontSize: 15,
      fontWeight: "600",
      color: c.text,
      fontVariant: ["tabular-nums"],
      minWidth: 40,
    },
    topSpacer: {
      width: 8,
    },
    playBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    waveRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 20,
      paddingHorizontal: 2,
    },
    waveDot: {
      width: 3,
      borderRadius: 2,
    },
    bottomRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    deleteBtn: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: c.destructive,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtn: {
      flex: 1,
      height: 48,
      borderRadius: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 16,
    },
    primaryBtnPause: {
      backgroundColor: c.modal,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
    },
    primaryBtnResume: {
      backgroundColor: c.accent,
    },
    primaryBtnText: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
    },
    primaryBtnTextOnAccent: {
      fontSize: 16,
      fontWeight: "600",
      color: c.accentOn,
    },
    sendBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: {
      backgroundColor: c.disabledButton,
    },
  });
}
