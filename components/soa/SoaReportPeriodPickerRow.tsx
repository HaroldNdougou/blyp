import type { createSoaReportStyles } from "@/components/soa/soaCarHomeStyles";
import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";

type SoaReportStyles = ReturnType<typeof createSoaReportStyles>;

export type SoaReportPeriodPickerRowModel = {
  key: string;
  label: string;
  amountFcfa: string | null;
  active: boolean;
};

type Props = {
  row: SoaReportPeriodPickerRowModel;
  styles: SoaReportStyles;
  onPress: () => void;
};

function SoaReportPeriodPickerRowInner({ row, styles, onPress }: Props) {
  return (
    <Pressable
      style={[styles.dayPickerRow, row.active && styles.dayPickerRowActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: row.active }}
    >
      <View style={styles.dayPickerRowLine}>
        <Text
          style={[
            styles.dayPickerRowText,
            styles.dayPickerRowDate,
            row.active && styles.dayPickerRowTextActive,
          ]}
        >
          {row.label}
          <Text
            style={[
              styles.dayPickerRowAmount,
              row.active && styles.dayPickerRowAmountActive,
            ]}
          >
            {" · "}
            {row.amountFcfa ?? "—"}
            {row.amountFcfa != null ? (
              <Text style={styles.dayPickerRowAmountCurrency}> F</Text>
            ) : null}
          </Text>
        </Text>
      </View>
    </Pressable>
  );
}

export const SoaReportPeriodPickerRow = memo(SoaReportPeriodPickerRowInner);
