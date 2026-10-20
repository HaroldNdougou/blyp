import { useTheme } from "@/contexts/ThemeContext";
import type { CommerceStamp } from "@/lib/receipts/commerceStampTypes";
import React, { useMemo } from "react";
import { Text, View } from "react-native";

type Props = {
  stamp: CommerceStamp;
  compact?: boolean;
};

export function MoneyReceiptStampPreview({ stamp, compact }: Props) {
  const { colors } = useTheme();
  const ink =
    stamp.color === "blue" ? colors.moneyReceiptStampBlue : colors.moneyReceiptStampRed;

  const styles = useMemo(
    () => ({
      circle: {
        width: compact ? 72 : 88,
        height: compact ? 72 : 88,
        borderRadius: compact ? 36 : 44,
        borderWidth: 2,
        borderColor: ink,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        paddingHorizontal: 6,
      },
      line: {
        borderWidth: 2,
        borderColor: ink,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: compact ? 6 : 10,
        alignSelf: "flex-start" as const,
        maxWidth: "100%" as const,
      },
      line1: {
        fontSize: compact ? 11 : 13,
        fontWeight: "800" as const,
        color: ink,
        textAlign: "center" as const,
      },
      line2: {
        fontSize: compact ? 9 : 11,
        fontWeight: "600" as const,
        color: ink,
        textAlign: "center" as const,
        marginTop: 2,
      },
    }),
    [compact, ink],
  );

  const body = (
    <>
      <Text style={styles.line1} numberOfLines={2}>
        {stamp.line1}
      </Text>
      {stamp.line2 ? (
        <Text style={styles.line2} numberOfLines={1}>
          {stamp.line2}
        </Text>
      ) : null}
    </>
  );

  if (stamp.shape === "line") {
    return <View style={styles.line}>{body}</View>;
  }
  return <View style={styles.circle}>{body}</View>;
}
