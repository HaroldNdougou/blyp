import type { createSoaCarHomeStyles } from "@/components/soa/soaCarHomeStyles";
import { formatFcfa } from "@/lib/formatFcfa";
import type { SoaSeatAggregate } from "@/lib/soa/seatAggregates";
import { SOA_CAR_SEAT_ROWS } from "@/lib/soa/soaCarLayout";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

type Styles = ReturnType<typeof createSoaCarHomeStyles>;

type DriverProps = {
  mode: "driver";
  styles: Styles;
  seatAggregate: (n: number) => SoaSeatAggregate | undefined;
  onSeatWithMultiplePayments?: (agg: SoaSeatAggregate) => void;
};

type PickerProps = {
  mode: "picker";
  styles: Styles;
  taken: Set<number>;
  selected: number | null;
  chipsDisabled: boolean;
  onSelect: (seat: number) => void;
};

type Props = DriverProps | PickerProps;

function DriverSeatCell({
  seatNumber,
  agg,
  styles,
  onSeatWithMultiplePayments,
  t,
}: {
  seatNumber: number;
  agg: SoaSeatAggregate | undefined;
  styles: Styles;
  onSeatWithMultiplePayments?: (agg: SoaSeatAggregate) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const paid = agg != null && agg.paymentCount > 0;
  const multi = paid && agg.paymentCount >= 2;
  const inner = (
    <>
      {multi ? (
        <View style={styles.seatPayCountBadge} pointerEvents="none">
          <Text style={styles.seatPayCountBadgeText}>×{agg.paymentCount}</Text>
        </View>
      ) : null}
      <Text style={[styles.seatNum, paid && styles.seatNumPaid]}>{seatNumber}</Text>
      {paid ? (
        <Text style={styles.seatAmt} numberOfLines={1}>
          {formatFcfa(agg.totalFcfa)}
        </Text>
      ) : null}
    </>
  );

  const a11y = t("soaCar.driverSeatA11y", {
    seat: seatNumber,
    paid: paid ? "yes" : "no",
  });

  if (multi && onSeatWithMultiplePayments) {
    return (
      <Pressable
        style={styles.seatCellOuter}
        onPress={() => onSeatWithMultiplePayments(agg)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        <View style={[styles.seatCell, styles.seatCellPaid]}>{inner}</View>
      </Pressable>
    );
  }

  return (
    <View style={styles.seatCellOuter} accessibilityLabel={a11y}>
      <View style={[styles.seatCell, paid && styles.seatCellPaid]}>{inner}</View>
    </View>
  );
}

export function SoaSeatMap(props: Props) {
  const { t } = useTranslation();
  const { styles, mode } = props;

  return (
    <View style={styles.seatMapBlock}>
      {SOA_CAR_SEAT_ROWS.map((row, rowIndex) => (
        <View key={`r-${rowIndex}`} style={styles.seatRow}>
          {row.map((n, colIndex) => {
            if (n == null) {
              return (
                <View
                  key={`e-${rowIndex}-${colIndex}`}
                  style={styles.seatSlotEmpty}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                />
              );
            }
            if (mode === "driver") {
              const { seatAggregate, onSeatWithMultiplePayments } = props;
              return (
                <DriverSeatCell
                  key={n}
                  seatNumber={n}
                  agg={seatAggregate(n)}
                  styles={styles}
                  onSeatWithMultiplePayments={onSeatWithMultiplePayments}
                  t={t}
                />
              );
            }
            const { taken, selected, chipsDisabled, onSelect } = props;
            const isTaken = taken.has(n);
            const isSelected = selected === n;
            return (
              <Pressable
                key={n}
                disabled={isTaken || chipsDisabled}
                onPress={() => onSelect(n)}
                style={[styles.seatCellOuter]}
                accessibilityRole="button"
                accessibilityState={{
                  selected: isSelected,
                  disabled: isTaken || chipsDisabled,
                }}
                accessibilityLabel={t("soaCar.seatA11y", { seat: n })}
              >
                <View
                  style={[
                    styles.seatCell,
                    isTaken && styles.seatCellTaken,
                    isSelected && styles.seatCellSelected,
                  ]}
                >
                  <Text style={styles.seatNum}>{n}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
