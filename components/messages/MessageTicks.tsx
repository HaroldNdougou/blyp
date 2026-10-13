import React, { memo } from "react";
import { View, type ViewStyle } from "react-native";

const BAR: ViewStyle = {
  position: "absolute",
  height: 2.15,
  borderRadius: 1,
};

function CheckMark({ color }: { color: string }) {
  return (
    <View style={{ width: 19, height: 14 }}>
      <View
        style={[
          BAR,
          {
            width: 7.5,
            backgroundColor: color,
            left: 0.7,
            bottom: 3.4,
            transform: [{ rotate: "45deg" }],
          },
        ]}
      />
      <View
        style={[
          BAR,
          {
            width: 13,
            backgroundColor: color,
            left: 4,
            bottom: 4.5,
            transform: [{ rotate: "-45deg" }],
          },
        ]}
      />
    </View>
  );
}

/** Message supprimé pour tous (expéditeur) — cercle barré type WhatsApp. */
export const DeletedMessageTick = memo(function DeletedMessageTick({
  color,
  compact,
}: {
  color: string;
  compact?: boolean;
}) {
  const size = 16;
  const stroke = 1.5;
  const marginLeft = compact ? 0 : 4;
  const marginRight = compact ? 4 : 0;
  return (
    <View
      style={{
        width: 19,
        height: 15,
        marginLeft,
        marginRight,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.9,
          height: stroke,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
});

/** Coches type WhatsApp — Views, pas d’image ni d’icône. */
export const MessageTicks = memo(function MessageTicks({
  color,
  double,
  compact,
}: {
  color: string;
  double: boolean;
  /** Liste discussions : marges réduites. */
  compact?: boolean;
}) {
  const marginLeft = compact ? 0 : 4;
  const marginRight = compact ? 4 : 0;
  if (!double) {
    return (
      <View
        style={{ width: 19, height: 15, marginLeft, marginRight }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <CheckMark color={color} />
      </View>
    );
  }
  return (
    <View
      style={{ width: 28, height: 15, marginLeft, marginRight }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={{ position: "absolute", left: 0 }}>
        <CheckMark color={color} />
      </View>
      <View
        style={{
          position: "absolute",
          left: 9,
          width: 15,
          height: 14,
          overflow: "hidden",
        }}
      >
        <View style={{ marginLeft: -3.5 }}>
          <CheckMark color={color} />
        </View>
      </View>
    </View>
  );
});
