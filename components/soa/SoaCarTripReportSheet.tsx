import {
  createSoaCarHomeStyles,
  createSoaTripDetailSheetStyles,
} from "@/components/soa/soaCarHomeStyles";
import { SoaSeatMap } from "@/components/soa/SoaSeatMap";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import type { SoaCarTripReportRow } from "@/lib/soa/soaCar";
import { buildSoaSeatAggregateMap } from "@/lib/soa/seatAggregates";
import type { SoaSeatPaymentDisplay } from "@/lib/soa/resolveSoaSeatPaymentDisplay";
import { buildSoaTripPaymentDisplays } from "@/lib/soa/soaTripDetailPayments";
import { getTransactionsSnapshot } from "@/lib/transactionsCache";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  InteractionManager,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TRIP_DETAIL_MODAL_ANIMATION = "slide" as const;

type Props = {
  visible: boolean;
  trip: SoaCarTripReportRow | null;
  courseNumber: number | null;
  /** Pré-calculé au pressIn sur la ligne (liste courses). */
  prewarmedPayments?: SoaSeatPaymentDisplay[] | null;
  onDismiss: () => void;
  onBack?: () => void;
};

export function SoaCarTripReportSheet({
  visible,
  trip,
  courseNumber,
  prewarmedPayments,
  onDismiss,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const androidNavBarH =
    Platform.OS === "android"
      ? Math.max(
          0,
          Math.round(
            Dimensions.get("screen").height - Dimensions.get("window").height,
          ),
        )
      : 0;
  /** Espace libéré après suppression du bouton Fermer (~marge + bouton). */
  const closeFooterReclaimPx = 56;
  const sheetBodyMax =
    Math.round(windowHeight * 0.85) + closeFooterReclaimPx;
  const sheetBottomPad = Math.max(insets.bottom, 12) + androidNavBarH;
  const styles = useMemo(
    () => createSoaTripDetailSheetStyles(colors),
    [colors],
  );
  const seatMapStyles = useMemo(
    () => createSoaCarHomeStyles(colors, { seatMapCompact: true }),
    [colors],
  );

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

  useEffect(() => {
    if (!visible) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void import("expo-system-ui").then((SystemUI) => {
        void SystemUI.setBackgroundColorAsync(colors.modal);
      });
    });
    return () => {
      task.cancel();
      void import("expo-system-ui").then((SystemUI) => {
        void SystemUI.setBackgroundColorAsync(colors.background);
      });
    };
  }, [visible, colors.modal, colors.background]);

  const payments = useMemo(() => {
    if (!trip) return [];
    if (
      prewarmedPayments &&
      prewarmedPayments.length === trip.seats.length
    ) {
      return prewarmedPayments;
    }
    const unknown = t("soaCar.reportPayerUnknown");
    return buildSoaTripPaymentDisplays(
      trip.seats,
      unknown,
      getTransactionsSnapshot(user?.phone),
    );
  }, [trip, prewarmedPayments, t, user?.phone]);

  const open = trip != null;

  return (
    <Modal
      visible={open}
      transparent
      animationType={TRIP_DETAIL_MODAL_ANIMATION}
      statusBarTranslucent
      onRequestClose={onBack ?? onDismiss}
    >
      {!trip ? null : (
      <View
        style={[
          styles.modalRoot,
          { minHeight: Dimensions.get("screen").height },
        ]}
      >
        <Pressable style={styles.modalBackdrop} onPress={onDismiss} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetBodyMax + androidNavBarH,
              height: sheetBodyMax + androidNavBarH,
              paddingBottom: 0,
            },
          ]}
        >
          <View style={styles.detailSheetTop}>
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

          </View>
          <View style={styles.detailSheetPayments}>
            <Text style={styles.paymentsListTitle}>
              {t("soaCar.reportTripPaymentsListTitle")}
            </Text>
            <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: sheetBottomPad },
            ]}
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
              payments.map((p, index) => (
                <View
                  key={`${p.seatNumber}-${p.paidAtLabel}-${index}`}
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
              ))
            )}
            </ScrollView>
          </View>
        </View>
      </View>
      )}
    </Modal>
  );
}
