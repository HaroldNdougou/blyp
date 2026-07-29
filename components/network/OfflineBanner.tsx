import { useNetwork } from "@/contexts/NetworkContext";
import { useTheme } from "@/contexts/ThemeContext";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Bannière fine type WhatsApp — non bloquante, disparaît dès le retour online. */
export function OfflineBanner() {
  const { isOffline } = useNetwork();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: isOffline ? 1 : 0,
        duration: isOffline ? 220 : 160,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: isOffline ? 0 : -8,
        duration: isOffline ? 220 : 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOffline, opacity, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          paddingTop: insets.top,
          backgroundColor: colors.surfaceMuted,
          borderBottomColor: colors.border,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t("network.offlineBanner")}
    >
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        {t("network.offlineBanner")}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
