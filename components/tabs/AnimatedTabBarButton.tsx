import { useTheme } from "@/contexts/ThemeContext";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import { useNavigationState } from "@react-navigation/native";
import React, { memo, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const PRESS_SCALE = 0.88;
const ICON_PEAK_SCALE = 1.1;
const SHRINK_MS = 90;
const PILL_DIFFUSE_MS = 260;
const SETTLE_TO_ONE_MS = 120;

const springPillGrow = { damping: 16, stiffness: 150, mass: 0.5 };

type Props = BottomTabBarButtonProps & {
  routeName: string;
};

function useTabRouteSelected(routeName: string): boolean {
  return useNavigationState((state) => {
    const route = state.routes[state.index ?? 0];
    return route?.name === routeName;
  });
}

function runSelectedAnimation(
  iconScale: SharedValue<number>,
  pillScale: SharedValue<number>,
  pillOpacity: SharedValue<number>,
) {
  pillScale.value = 0.48;
  pillOpacity.value = 0;

  iconScale.value = withSequence(
    withTiming(PRESS_SCALE, { duration: SHRINK_MS }),
    withTiming(ICON_PEAK_SCALE, {
      duration: PILL_DIFFUSE_MS,
      easing: Easing.out(Easing.cubic),
    }),
    withTiming(1, {
      duration: SETTLE_TO_ONE_MS,
      easing: Easing.inOut(Easing.cubic),
    }),
  );
  pillScale.value = withDelay(SHRINK_MS, withSpring(1, springPillGrow));
  pillOpacity.value = withDelay(
    SHRINK_MS,
    withTiming(1, {
      duration: PILL_DIFFUSE_MS,
      easing: Easing.out(Easing.cubic),
    }),
  );
}

/** Pastille + icône : une seule séquence à la sélection (pas de double anim au press). */
function AnimatedTabBarButtonInner({
  children,
  routeName,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const selected = useTabRouteSelected(routeName);
  const wasSelectedRef = useRef(selected);

  const iconScale = useSharedValue(1);
  const pillScale = useSharedValue(selected ? 1 : 0.5);
  const pillOpacity = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    const was = wasSelectedRef.current;
    wasSelectedRef.current = selected;

    if (selected && !was) {
      runSelectedAnimation(iconScale, pillScale, pillOpacity);
      return;
    }
    if (!selected && was) {
      pillOpacity.value = withTiming(0, { duration: 90 });
      pillScale.value = withTiming(0.5, { duration: 90 });
      iconScale.value = withTiming(1, { duration: 90 });
    }
  }, [selected, pillOpacity, pillScale, iconScale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
    transform: [{ scale: pillScale.value }],
  }));

  return (
    <PlatformPressable {...rest} pressOpacity={1}>
      <View style={styles.slot}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            { backgroundColor: colors.tabBarActivePill },
            pillStyle,
          ]}
        />
        <Animated.View style={[styles.iconWrap, iconStyle]}>
          {children}
        </Animated.View>
      </View>
    </PlatformPressable>
  );
}

export const AnimatedTabBarButton = memo(AnimatedTabBarButtonInner);

const styles = StyleSheet.create({
  slot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    position: "absolute",
    width: 68,
    height: 38,
    borderRadius: 19,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
