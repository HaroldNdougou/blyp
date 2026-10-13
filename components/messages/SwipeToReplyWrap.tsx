import { useTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const THRESHOLD = 44;
const MAX_DRAG = 72;

type Props = {
  children: React.ReactNode;
  enabled: boolean;
  onReply: () => void;
};

export function SwipeToReplyWrap({ children, enabled, onReply }: Props) {
  const { colors } = useTheme();
  const tx = useSharedValue(0);
  const fired = useSharedValue(false);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const triggerReply = useCallback(() => {
    onReplyRef.current();
  }, []);

  const pan = useMemo(() => {
    return Gesture.Pan()
      .enabled(enabled)
      .activeOffsetX(8)
      .failOffsetX(-8)
      .failOffsetY([-14, 14])
      .onUpdate((e) => {
        const x = Math.max(0, Math.min(e.translationX, MAX_DRAG));
        tx.value = x;
        fired.value = x >= THRESHOLD;
      })
      .onEnd(() => {
        if (fired.value) {
          runOnJS(triggerReply)();
        }
        tx.value = withSpring(0, { damping: 20, stiffness: 380 });
        fired.value = false;
      });
  }, [enabled, fired, tx, triggerReply]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const p = Math.min(1, tx.value / THRESHOLD);
    return {
      opacity: p * 0.95,
      transform: [{ scale: 0.65 + p * 0.4 }],
    };
  });

  return (
    <View style={{ position: "relative" }}>
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 2,
            top: "50%",
            marginTop: -12,
            zIndex: 0,
          },
          iconStyle,
        ]}
        pointerEvents="none"
      >
        <Ionicons name="arrow-undo" size={22} color={colors.accent} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[rowStyle, { alignSelf: "flex-start", maxWidth: "100%" }]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
