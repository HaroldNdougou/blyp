/**
 * Glyphes Pay en Views/Text — pas d’Ionicons sur le chemin critique (1er frame).
 */
import React from "react";
import { Text, View } from "react-native";

export function BackspaceGlyph({ color }: { color: string }) {
  return (
    <Text
      style={{
        fontSize: 22,
        fontWeight: "600",
        color,
        marginTop: -2,
      }}
    >
      ⌫
    </Text>
  );
}

/** Coche succès PIN / reçu — sans police d’icônes. */
export function CheckGlyph({
  color,
  size = 36,
}: {
  color: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(2, Math.round(size / 18)),
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityRole="image"
    >
      <Text
        style={{
          color,
          fontSize: size * 0.52,
          fontWeight: "800",
          marginTop: -1,
        }}
      >
        ✓
      </Text>
    </View>
  );
}
