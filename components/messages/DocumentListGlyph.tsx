import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  color: string;
  style?: StyleProp<ViewStyle>;
};

/** Icône document compacte (liste des discussions), style WhatsApp. */
export function DocumentListGlyph({ color, style }: Props) {
  return (
    <View style={[{ width: 18, height: 18, marginRight: 4 }, style]}>
      <View
        style={{
          position: "absolute",
          left: 2,
          top: 1,
          width: 13,
          height: 16,
          borderWidth: 1.2,
          borderColor: color,
          borderRadius: 2,
          opacity: 0.9,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 5,
          top: 6,
          width: 8,
          height: 1.2,
          backgroundColor: color,
          opacity: 0.65,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 5,
          top: 9,
          width: 6,
          height: 1.2,
          backgroundColor: color,
          opacity: 0.5,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 5,
          top: 12,
          width: 7,
          height: 1.2,
          backgroundColor: color,
          opacity: 0.4,
        }}
      />
    </View>
  );
}
