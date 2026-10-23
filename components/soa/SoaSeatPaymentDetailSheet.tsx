import { createSoaSeatSheetStyles } from "@/components/soa/soaCarHomeStyles";
import type { SoaSeatAggregate } from "@/lib/soa/seatAggregates";
import { formatSoaPaymentWhen } from "@/lib/soa/formatSoaPaymentWhen";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import { modalPresentation } from "@/lib/perf/instantMotion";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  aggregate: SoaSeatAggregate | null;
  onDismiss: () => void;
};

export function SoaSeatPaymentDetailSheet({
  visible,
  aggregate,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const sheetStyles = useMemo(
    () => createSoaSeatSheetStyles(colors),
    [colors],
  );

  if (!aggregate || aggregate.paymentCount < 2) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onDismiss}
    >
      <Pressable style={sheetStyles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[
            sheetStyles.sheet,
            { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={sheetStyles.title}>
            {t("soaCar.seatPaymentsTitle", { seat: aggregate.seatNumber })}
          </Text>
          <Text style={sheetStyles.sub}>
            {t("soaCar.seatPaymentsSub", {
              count: aggregate.paymentCount,
              total: formatFcfa(aggregate.totalFcfa),
            })}
          </Text>
          <ScrollView
            style={{ maxHeight: 280 }}
            showsVerticalScrollIndicator={false}
          >
            {aggregate.payments.map((p, i) => (
              <View
                key={`${p.transactionId}-${i}`}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 10,
                  borderBottomWidth: i < aggregate.payments.length - 1 ? 1 : 0,
                  borderBottomColor: colors.borderLight,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: colors.text,
                  }}
                >
                  {formatFcfa(p.amountFcfa)} {t("common.fcfa")}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: colors.textMuted,
                  }}
                >
                  {formatSoaPaymentWhen(p.paidAt)}
                </Text>
              </View>
            ))}
          </ScrollView>
          <Pressable
            style={[sheetStyles.cancelBtn, { marginTop: 16 }]}
            onPress={onDismiss}
            accessibilityRole="button"
          >
            <Text style={sheetStyles.cancelText}>{t("common.close")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
