import { useTheme } from "@/contexts/ThemeContext";
import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  count: number;
  style?: StyleProp<ViewStyle>;
  /** Pastille rouge (alerte) au lieu du vert accent. */
  variant?: "accent" | "destructive";
};

export function CountBadge({ count, style, variant = "accent" }: Props) {
  const { colors } = useTheme();
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return null;
  const bg =
    variant === "destructive" ? colors.destructive : colors.accent;
  const fg = variant === "destructive" ? colors.textInverse : colors.accentOn;
  return (
    <View
      style={[
        {
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          paddingHorizontal: 4,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Text style={{ color: fg, fontSize: 10, fontWeight: "700" }}>
        {n > 99 ? "99+" : String(n)}
      </Text>
    </View>
  );
}
