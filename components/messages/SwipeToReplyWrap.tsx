import { useTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** Glisser horizontal net avant d’accrocher (scroll vertical prioritaire). */
const ACTIVATE_X = 22;
const THRESHOLD = 44;
const MAX_DRAG = 72;
const SNAP_BACK_MS = 200;

/** Piste waveform — le swipe « répondre » ne démarre pas ici (bulle vocale). */
export type SwipeTrackExclusion = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
};

type Props = {
  children: React.ReactNode;
  enabled: boolean;
  onReply: () => void;
  /** Bulle vocale : rectangle piste exclu ; le pan déplace toujours tout le contenu. */
  trackExclusion?: SwipeTrackExclusion;
};

function attachReplyPanHandlers(
  pan: ReturnType<typeof Gesture.Pan>,
  opts: {
    tx: SharedValue<number>;
    fired: SharedValue<boolean>;
    hapticArmed: SharedValue<boolean>;
    bumpHaptic: () => void;
    triggerReply: () => void;
  },
) {
  const { tx, fired, hapticArmed, bumpHaptic, triggerReply } = opts;
  return pan
    .onUpdate((e) => {
      "worklet";
      const x = Math.max(0, Math.min(e.translationX, MAX_DRAG));
      tx.value = x;
      if (x >= THRESHOLD && !hapticArmed.value) {
        hapticArmed.value = true;
        runOnJS(bumpHaptic)();
      }
      if (x < THRESHOLD * 0.65) {
        hapticArmed.value = false;
      }
      fired.value = x >= THRESHOLD;
    })
    .onEnd(() => {
      "worklet";
      if (fired.value) {
        runOnJS(triggerReply)();
      }
      tx.value = withTiming(0, {
        duration: SNAP_BACK_MS,
        easing: Easing.out(Easing.cubic),
      });
      fired.value = false;
      hapticArmed.value = false;
    })
    .onFinalize((_e, success) => {
      "worklet";
      if (!success) {
        tx.value = withTiming(0, {
          duration: SNAP_BACK_MS,
          easing: Easing.out(Easing.cubic),
        });
        fired.value = false;
        hapticArmed.value = false;
      }
    });
}

function touchInTrackExclusion(
  x: number,
  y: number,
  ex: SwipeTrackExclusion,
): boolean {
  "worklet";
  const ew = ex.w.value;
  const eh = ex.h.value;
  if (ew <= 0 || eh <= 0) return false;
  return (
    x >= ex.x.value &&
    x <= ex.x.value + ew &&
    y >= ex.y.value &&
    y <= ex.y.value + eh
  );
}

export function SwipeToReplyWrap({
  children,
  enabled,
  onReply,
  trackExclusion,
}: Props) {
  const { colors } = useTheme();
  const tx = useSharedValue(0);
  const fired = useSharedValue(false);
  const hapticArmed = useSharedValue(false);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;

  const triggerReply = useCallback(() => {
    onReplyRef.current();
  }, []);

  const bumpHaptic = useCallback(() => {
    void import("@/lib/messages/chatLongPressHaptic").then((m) =>
      m.fireChatLongPressHaptic(),
    );
  }, []);

  const handlerOpts = useMemo(
    () => ({ tx, fired, hapticArmed, bumpHaptic, triggerReply }),
    [bumpHaptic, fired, hapticArmed, triggerReply, tx],
  );

  const gesture = useMemo(() => {
    if (trackExclusion) {
      const pan = Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          "worklet";
          if (!enabled) {
            state.fail();
            return;
          }
          const t = e.allTouches[0];
          if (!t) return;
          if (touchInTrackExclusion(t.x, t.y, trackExclusion)) {
            state.fail();
          }
        })
        .onTouchesMove((e, state) => {
          "worklet";
          if (Math.abs(e.translationY) > 10) {
            state.fail();
            return;
          }
          if (e.translationX > ACTIVATE_X || e.translationX < -14) {
            state.activate();
          }
        });
      return attachReplyPanHandlers(pan, handlerOpts);
    }

    const pan = Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .activeOffsetX(ACTIVATE_X)
      .failOffsetX(-14)
      .failOffsetY([-10, 10]);
    return attachReplyPanHandlers(pan, handlerOpts);
  }, [enabled, handlerOpts, trackExclusion]);

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
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[rowStyle, { alignSelf: "flex-start", maxWidth: "100%" }]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
