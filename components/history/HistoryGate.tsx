/**
 * Coquille légère onglet Transactions — titre immédiat si le corps FlashList
 * n’est pas encore en mémoire (1er clic après reload).
 */
import { createHistoryStyles } from "@/components/history/historyStyles";
import {
  getPreloadedHistoryScreen,
  preloadHistoryScreen,
} from "@/components/history/preloadHistory";
import { useTheme } from "@/contexts/ThemeContext";
import React, { useEffect, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function HistoryGate() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createHistoryStyles(colors), [colors]);
  const [Body, setBody] = useState<ComponentType | null>(
    () => getPreloadedHistoryScreen(),
  );

  useEffect(() => {
    if (Body) return;
    let alive = true;
    void preloadHistoryScreen().then((C) => {
      if (alive) setBody(() => C);
    });
    return () => {
      alive = false;
    };
  }, [Body]);

  if (Body) return <Body />;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("history.title")}</Text>
        <Text style={styles.subtitle}>{t("history.subtitleEmpty")}</Text>
      </View>
      <View style={styles.emptyWrap}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    </SafeAreaView>
  );
}
