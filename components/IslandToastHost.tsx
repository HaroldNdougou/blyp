import type { ToastVariant } from "@/lib/inAppToast";
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type IslandToastItem = {
  id: string;
  title?: string;
  message: string;
  emoji?: string;
  variant: ToastVariant;
  durationMs: number;
  notificationId?: string;
};

const VARIANT_ACCENT: Record<
  ToastVariant,
  { glow: string; border: string }
> = {
  success: { glow: "rgba(34, 197, 94, 0.35)", border: "rgba(255,255,255,0.14)" },
  info: { glow: "rgba(59, 130, 246, 0.3)", border: "rgba(255,255,255,0.12)" },
  warning: { glow: "rgba(245, 158, 11, 0.35)", border: "rgba(255,255,255,0.12)" },
  error: { glow: "rgba(239, 68, 68, 0.35)", border: "rgba(255,255,255,0.12)" },
};

type Props = {
  item: IslandToastItem | null;
  onFinished: () => void;
};

export function IslandToastHost({ item, onFinished }: Props) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (!item) {
      progress.value = 0;
      return;
    }

    progress.value = 0;
    progress.value = withSpring(1, {
      damping: 18,
      stiffness: 260,
      mass: 0.82,
      overshootClamping: false,
    });

    const holdMs = item.durationMs;
    let cancelled = false;
    const holdTimer = setTimeout(() => {
      if (cancelled) return;
      progress.value = withTiming(
        0,
        {
          duration: Platform.OS === "ios" ? 360 : 320,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
        },
        (finished) => {
          if (finished) runOnJS(() => onFinishedRef.current())();
        },
      );
    }, holdMs);

    return () => {
      cancelled = true;
      clearTimeout(holdTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anim déclenchée par id / durée seulement
  }, [item?.id, item?.durationMs, progress]);

  const shellStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const translateY = (1 - p) * -(18 + insets.top * 0.15);
    const scale = 0.88 + p * 0.12;
    return {
      opacity: p,
      transform: [{ translateY }, { scale }],
    };
  });

  if (!item) {
    return (
      <View
        style={styles.fill}
        pointerEvents="none"
        collapsable={false}
      />
    );
  }

  const accent = VARIANT_ACCENT[item.variant];

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.anchor,
          { paddingTop: Math.max(insets.top, 12) + 4 },
          shellStyle,
        ]}
      >
        <View
          style={[
            styles.pill,
            {
              borderColor: accent.border,
              shadowColor: accent.glow,
            },
          ]}
        >
          {item.emoji ? (
            <Text style={styles.emoji} allowFontScaling={false}>
              {item.emoji}
            </Text>
          ) : null}
          <View style={styles.textCol}>
            {item.title ? (
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
            ) : null}
            <Text style={styles.message} numberOfLines={4}>
              {item.message}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  anchor: {
    alignItems: "center",
    paddingHorizontal: 20,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: "#121214",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  emoji: {
    fontSize: 26,
    marginRight: 12,
    lineHeight: 30,
  },
  textCol: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  title: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  message: {
    color: "rgba(250,250,250,0.88)",
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.1,
  },
});
