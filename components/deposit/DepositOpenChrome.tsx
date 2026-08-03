/**
 * Coquille visuelle instantanée du modal Recharger.
 * Affichée au clic pendant que la route /deposit finit de monter (0 frame mort).
 */
import { useTheme } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/lib/theme/colors";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SHEET_HEIGHT_RATIO = 0.85;

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 200,
      elevation: 40,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    sheetShell: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.modal,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      overflow: "hidden",
    },
    safe: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
    },
    closeBtn: {
      width: 44,
      height: 44,
      justifyContent: "center",
      alignItems: "flex-start",
    },
    closeText: { fontSize: 28, color: c.text, lineHeight: 32 },
    headerTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: c.text,
    },
    headerSpacer: { width: 44 },
    body: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 28,
      alignItems: "center",
    },
    hint: {
      marginTop: 16,
      fontSize: 13,
      fontWeight: "600",
      color: c.textMuted,
    },
  });
}

export function DepositOpenChrome({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel={t("common.close")}
      />
      <View style={[styles.sheetShell, { height: sheetHeight }]}>
        <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
          <View style={styles.header}>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
            <Text style={styles.headerTitle}>{t("deposit.title")}</Text>
            <View style={styles.headerSpacer} />
          </View>
          <View style={styles.body}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.hint}>{t("deposit.title")}</Text>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
