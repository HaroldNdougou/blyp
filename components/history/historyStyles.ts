import { StyleSheet } from "react-native";
import type { ThemeColors } from "@/lib/theme/colors";

export function createHistoryStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingHorizontal: 25,
      paddingVertical: 20,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      color: c.text,
    },
    listFlex: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    emptyWrap: {
      paddingTop: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      marginTop: 32,
      textAlign: "center",
      paddingHorizontal: 24,
      fontSize: 15,
      color: c.textMuted,
      lineHeight: 22,
    },
    transactionItem: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    leftContent: {
      flexDirection: "row",
      alignItems: "center",
    },
    avatarSmall: {
      width: 45,
      height: 45,
      borderRadius: 22.5,
      backgroundColor: c.avatarBackground,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 15,
    },
    avatarText: {
      fontSize: 18,
      fontWeight: "600",
      color: c.avatarText,
    },
    nameText: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
    },
    dateText: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 2,
    },
    amountText: {
      fontSize: 16,
      fontWeight: "700",
    },
    greenText: { color: c.successAmount },
    blackText: { color: c.sentAmount },
  });
}
