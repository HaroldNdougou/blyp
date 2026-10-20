import React from "react";
import { Text } from "react-native";

/** Mini $ — fruit money vs emoji fruit seul ; pas d’Ionicons. */
export function FruitMoneyDollarGlyph({
  color,
  size = 9,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Text
      style={{
        color,
        fontSize: size,
        lineHeight: size + 1,
        fontWeight: "800",
        marginRight: 2,
        includeFontPadding: false,
        textAlign: "center",
        minWidth: size,
      }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      $
    </Text>
  );
}
