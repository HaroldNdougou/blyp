import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import type { ThemeColors } from "@/lib/theme/colors";
import React from "react";
import { StyleSheet, View } from "react-native";

type Props = {
  colors: ThemeColors;
  styles: ReturnType<typeof createMessagesStyles>;
};

const DOT = 7;
const GAP = 4;

/** Bulle trois points (style WhatsApp) sous le fil. */
export function TypingDotsBubble({ colors, styles }: Props) {
  const dotColor = colors.bubbleTheirsText;

  return (
    <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, styles.bubbleTheirs, local.bubble]}>
        <View style={local.row}>
          <View style={[local.dot, { backgroundColor: dotColor }]} />
          <View style={[local.dot, { backgroundColor: dotColor }]} />
          <View style={[local.dot, { backgroundColor: dotColor }]} />
        </View>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    minWidth: 52,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: GAP,
    height: DOT,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    opacity: 0.55,
  },
});
