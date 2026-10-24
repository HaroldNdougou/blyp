import type { createSoaReportStyles } from "@/components/soa/soaCarHomeStyles";
import { formatFcfa } from "@/lib/formatFcfa";
import type { SoaCarTripReportRow } from "@/lib/soa/soaCar";
import React from "react";
import { Pressable, Text, View } from "react-native";

type ReportStyles = ReturnType<typeof createSoaReportStyles>;

type Props = {
  item: SoaCarTripReportRow;
  title: string;
  styles: ReportStyles;
  onPress: () => void;
};

export const SoaReportTripListRow = React.memo(function SoaReportTripListRow({
  item,
  title,
  styles,
  onPress,
}: Props) {
  const isActive = item.isActive;

  return (
    <Pressable
      style={styles.tripRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ busy: isActive }}
    >
      <View style={styles.tripTitleRow}>
        {isActive ? <View style={styles.tripActivePulseDot} /> : null}
        <Text
          style={[styles.tripTitle, isActive && styles.tripTitleActive]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      <View style={styles.summaryAmountRow}>
        <Text style={styles.tripAmount}>{formatFcfa(item.totalFcfa)}</Text>
        <Text style={styles.tripAmountCurrency}>F</Text>
      </View>
    </Pressable>
  );
});
