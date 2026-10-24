import {
  createSoaCarHomeStyles,
  createSoaTripDetailSheetStyles,
} from "@/components/soa/soaCarHomeStyles";
import { SoaSeatMap } from "@/components/soa/SoaSeatMap";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import { modalPresentation } from "@/lib/perf/instantMotion";
import type { SoaCarTripReportRow } from "@/lib/soa/soaCar";
import {
  indexTransactionsById,
  resolveSoaSeatPaymentDisplay,
} from "@/lib/soa/resolveSoaSeatPaymentDisplay";
import { buildSoaSeatAggregateMap } from "@/lib/soa/seatAggregates";
import { getTransactionsSnapshot } from "@/lib/transactionsCache";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  trip: SoaCarTripReportRow | null;
  courseNumber: number | null;
  onDismiss: () => void;
  onBack?: () => void;
};

export function SoaCarTripReportSheet({
  visible,
  trip,
  courseNumber,
  onDismiss,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () => createSoaTripDetailSheetStyles(colors),
    [colors],
  );
  const seatMapStyles = useMemo(
    () => createSoaCarHomeStyles(colors, { seatMapCompact: true }),
    [colors],
  );

  const txById = useMemo(() => {
    const phone = user?.phone;
    if (!phone) return new Map();
    return indexTransactionsById(getTransactionsSnapshot(phone));
  }, [user?.phone, visible, trip?.tripId]);

  const seatAggregates = useMemo(
    () => (trip ? buildSoaSeatAggregateMap(trip.seats) : new Map()),
    [trip],
  );

  const seatAggregate = useCallback(
    (seatNumber: number) => seatAggregates.get(seatNumber),
    [seatAggregates],
  );

  const title = useMemo(() => {
    if (!trip) return "";
    if (trip.isActive) return t("soaCar.reportTripActive");
    if (courseNumber != null) {
      return t("soaCar.reportTripLineDetail", { n: courseNumber });
    }
    return t("soaCar.reportTripDetailTitle");
  }, [trip, courseNumber, t]);

  const payments = useMemo(() => {
    if (!trip) return [];
    const unknown = t("soaCar.reportPayerUnknown");
    return [...trip.seats]
      .sort(
        (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
      )
      .map((seat) => resolveSoaSeatPaymentDisplay(seat, txById, unknown));
  }, [trip, txById, t]);

  if (!trip) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onBack ?? onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.detailSheetHeader}>
            {onBack ? (
              <Pressable
                style={styles.detailSheetBackBtn}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel={t("common.back")}
              >
                <Ionicons name="chevron-back" size={26} color={colors.text} />
              </Pressable>
            ) : (
              <View style={styles.detailSheetHeaderSpacer} />
            )}
            <Text style={[styles.title, styles.detailSheetHeaderTitle]}>
              {title}
            </Text>
            <View style={styles.detailSheetHeaderSpacer} />
          </View>
          <Text style={[styles.sub, styles.detailSheetSub]}>
            {formatFcfa(trip.totalFcfa)} {t("common.fcfa")}
            {" · "}
            {t("soaCar.reportPaymentsCount", { count: trip.seats.length })}
          </Text>

          <View style={styles.seatMapSection}>
            <SoaSeatMap
              mode="driver"
              styles={seatMapStyles}
              seatAggregate={seatAggregate}
            />
          </View>

          <Text style={styles.paymentsListTitle}>
            {t("soaCar.reportTripPaymentsListTitle")}
          </Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {payments.length === 0 ? (
              <View style={styles.emptyPayments}>
                <Text style={styles.emptyPaymentsText}>
                  {t("soaCar.reportTripPaymentsEmpty")}
                </Text>
              </View>
            ) : (
              trip.seats
                .sort(
                  (a, b) =>
                    new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
                )
                .map((seat) => {
                  const unknown = t("soaCar.reportPayerUnknown");
                  const p = resolveSoaSeatPaymentDisplay(
                    seat,
                    txById,
                    unknown,
                  );
                  return (
                <View
                  key={seat.transactionId}
                  style={styles.paymentRow}
                >
                  <View style={styles.paymentRowTop}>
                    <Text style={styles.paymentPayerName} numberOfLines={2}>
                      {p.payerName}
                    </Text>
                    <Text style={styles.paymentAmount}>
                      {formatFcfa(p.amountFcfa)} F
                    </Text>
                  </View>
                  {p.payerPhone ? (
                    <Text style={styles.paymentPhone}>{p.payerPhone}</Text>
                  ) : null}
                  <Text style={styles.paymentMeta}>
                    {t("soaCar.reportTripPaymentSeat", { seat: p.seatNumber })}
                    {" · "}
                    {p.paidAtLabel}
                  </Text>
                </View>
                  );
                })
            )}
          </ScrollView>
          <Pressable
            style={[styles.cancelBtn, { marginTop: 12 }]}
            onPress={onDismiss}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>{t("common.close")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
