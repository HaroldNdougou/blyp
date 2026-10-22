import { createNetworkBannerStyles } from "@/components/network/networkBannerStyles";
import { useNetwork } from "@/contexts/NetworkContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { NetworkBannerKind } from "@/lib/network/state";
import React, { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function stripKey(kind: NetworkBannerKind): string {
  return kind === "offline"
    ? "network.stripOffline"
    : "network.stripNoInternet";
}

/** Bande fine type WhatsApp — overlay, ne repousse pas l’app. */
export function OfflineBanner() {
  const { bannerKind } = useNetwork();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createNetworkBannerStyles(colors), [colors]);

  const visible = bannerKind != null;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 120,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  const label =
    bannerKind != null ? t(stripKey(bannerKind)) : t("network.offlineBanner");

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + 2,
          backgroundColor: colors.surfaceMuted,
          opacity,
        },
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      {visible ? <Text style={styles.text}>{label}</Text> : null}
    </Animated.View>
  );
}
