import { ActusPanel } from "@/components/status/ActusPanel";
import { createStatusStyles } from "@/components/status/statusStyles";
import { useTheme } from "@/contexts/ThemeContext";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Écran stack `/actus` (lien direct) — l’entrée principale est l’onglet Messages. */
export default function ActusScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.actusRoot} edges={["top", "left", "right"]}>
      <View style={styles.actusTopBar}>
        <Pressable
          style={styles.actusBackBtn}
          onPress={() => router.back()}
          accessibilityLabel={t("common.back")}
        >
          <Text style={{ fontSize: 28, color: colors.text }}>‹</Text>
        </Pressable>
        <Text style={styles.actusTitle}>{t("actus.title")}</Text>
      </View>
      <ActusPanel isActive={true} />
    </SafeAreaView>
  );
}
