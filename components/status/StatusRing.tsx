import type { ThemeColors } from "@/lib/theme/colors";
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  children: React.ReactNode;
  colors: ThemeColors;
  variant: "unseen" | "seen" | "add" | "none";
  style?: StyleProp<ViewStyle>;
};

export function StatusRing({ children, colors, variant, style }: Props) {
  if (variant === "none") {
    return <View style={style}>{children}</View>;
  }
  const borderColor =
    variant === "unseen"
      ? colors.accent
      : variant === "add"
        ? colors.borderLight
        : colors.border;
  return (
    <View
      style={[
        {
          padding: 2.5,
          borderRadius: 999,
          borderWidth: 2.5,
          borderColor,
          borderStyle: variant === "add" ? "dashed" : "solid",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
