import React from "react";
import { View } from "react-native";

/** Silhouette contact sans photo — style WhatsApp (tête + épaules). */
export function AnonymousPersonGlyph({
  color,
  size = 24,
}: {
  color: string;
  size?: number;
}) {
  const head = size * 0.34;
  const bodyW = size * 0.62;
  const bodyH = size * 0.3;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          width: head,
          height: head,
          borderRadius: head / 2,
          backgroundColor: color,
          marginBottom: size * 0.05,
        }}
      />
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderTopLeftRadius: bodyW * 0.5,
          borderTopRightRadius: bodyW * 0.5,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
