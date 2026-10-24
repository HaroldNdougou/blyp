import { createHistoryStyles } from "@/components/history/historyStyles";
import { createSoaReportStyles } from "@/components/soa/soaCarHomeStyles";
import { SoaCarTripListSheet } from "@/components/soa/SoaCarTripListSheet";
import { SoaCarTripReportSheet } from "@/components/soa/SoaCarTripReportSheet";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import { subscribeIncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import type { SoaReportTripListItem } from "@/lib/soa/soaReportTripList";
import { formatSoaReportDayLabel } from "@/lib/soa/formatSoaReportDayLabel";
import { soaCommerceDayKey, soaRecentDayKeys } from "@/lib/soa/soaDayKey";
import {
  getSoaDayReportSnapshot,
  subscribeSoaDayReport,
} from "@/lib/soa/soaReportCache";
import { orderSoaReportTripsForList } from "@/lib/soa/soaReportTripList";
import {
  formatSoaReportGrowthRate,
  resolveSoaReportRevenueTrend,
} from "@/lib/soa/soaReportDayTrend";
import {
  readSoaDayReportOrEmpty,
  syncSoaDayReportFromNetwork,
} from "@/lib/soa/soaReportSync";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = {
  commerceId: string;
};

export function SoaCarReportScreen({ commerceId }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createSoaReportStyles(colors), [colors]);
  const historyStyles = useMemo(() => createHistoryStyles(colors), [colors]);
  const { token } = useAuth();
  const dayKeys = useMemo(() => soaRecentDayKeys(14), []);
  const [selectedDay, setSelectedDay] = useState(() => soaCommerceDayKey());
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [dayTriggerHeight, setDayTriggerHeight] = useState(40);
  const [tick, setTick] = useState(0);
  const [tripsSheetOpen, setTripsSheetOpen] = useState(false);
  const [trendHintOpen, setTrendHintOpen] = useState(false);
  const [detailTrip, setDetailTrip] = useState<SoaReportTripListItem | null>(
    null,
  );
  const focusedRef = useRef(false);
  const commerceIdRef = useRef(commerceId);
  commerceIdRef.current = commerceId;

  void tick;
  const report = readSoaDayReportOrEmpty(commerceId, selectedDay);

  const refresh = useCallback(
    (force?: boolean) => {
      if (!token) return;
      syncSoaDayReportFromNetwork(token, commerceId, selectedDay, { force });
    },
    [token, commerceId, selectedDay],
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      refresh(true);
      return () => {
        focusedRef.current = false;
      };
    }, [refresh]),
  );

  useEffect(() => {
    return subscribeSoaDayReport(() => setTick((n) => n + 1));
  }, []);

  useEffect(() => {
    return subscribeIncomingPaymentFlash((event) => {
      if (!focusedRef.current) return;
      if (event.contextType !== "commerce") return;
      if (event.commerceId && event.commerceId !== commerceIdRef.current) {
        return;
      }
      refresh(true);
    });
  }, [refresh]);

  const selectedDayIndex = Math.max(0, dayKeys.indexOf(selectedDay));
  const selectedDayLabel = formatSoaReportDayLabel(
    selectedDay,
    selectedDayIndex,
    t,
  );

  const completedTripCount = useMemo(
    () => report.trips.filter((trip) => !trip.isActive).length,
    [report.trips],
  );
  const completedTripCountLabel = String(completedTripCount).padStart(2, "0");

  const listTrips = useMemo(
    () => orderSoaReportTripsForList(report.trips),
    [report.trips],
  );

  const previousDayKey =
    selectedDayIndex + 1 < dayKeys.length
      ? dayKeys[selectedDayIndex + 1]
      : null;
  const previousDayTotal = useMemo(() => {
    if (!previousDayKey) return null;
    const snap = getSoaDayReportSnapshot(commerceId, previousDayKey);
    return snap ? snap.totalFcfa : null;
  }, [commerceId, previousDayKey, tick]);
  const revenueTrend = useMemo(
    () => resolveSoaReportRevenueTrend(report.totalFcfa, previousDayTotal),
    [report.totalFcfa, previousDayTotal],
  );

  useEffect(() => {
    if (!token || !previousDayKey) return;
    syncSoaDayReportFromNetwork(token, commerceId, previousDayKey);
  }, [token, commerceId, previousDayKey]);

  useEffect(() => {
    setTrendHintOpen(false);
  }, [selectedDay]);

  const previousDayLabel =
    previousDayKey != null
      ? formatSoaReportDayLabel(
          previousDayKey,
          selectedDayIndex + 1,
          t,
        )
      : "";
  const growthRateLabel =
    previousDayTotal != null
      ? formatSoaReportGrowthRate(report.totalFcfa, previousDayTotal)
      : "";

  const onPickDay = useCallback((dk: string) => {
    setSelectedDay(dk);
    setDayPickerOpen(false);
  }, []);

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={historyStyles.header}>
        <Text style={historyStyles.title}>{t("history.title")}</Text>
      </View>
      <View style={styles.daySelectHost}>
        <View style={styles.daySelectWrap}>
          <Pressable
            style={styles.daySelect}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && h !== dayTriggerHeight) setDayTriggerHeight(h);
            }}
            onPress={() => {
              setTrendHintOpen(false);
              setDayPickerOpen((o) => !o);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("soaCar.reportSelectDayA11y")}
            accessibilityState={{ expanded: dayPickerOpen }}
          >
            <Text style={styles.daySelectText}>{selectedDayLabel}</Text>
            <Ionicons
              name={dayPickerOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textMuted}
            />
          </Pressable>
          {dayPickerOpen ? (
            <View
              style={[
                styles.dayDropdown,
                { top: dayTriggerHeight + 6 },
              ]}
            >
              <ScrollView
                style={styles.dayDropdownScroll}
                nestedScrollEnabled
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                {dayKeys.map((dk, i) => {
                  const active = dk === selectedDay;
                  return (
                    <Pressable
                      key={dk}
                      style={[
                        styles.dayPickerRow,
                        active && styles.dayPickerRowActive,
                      ]}
                      onPress={() => onPickDay(dk)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.dayPickerRowText,
                          active && styles.dayPickerRowTextActive,
                        ]}
                      >
                        {formatSoaReportDayLabel(dk, i, t)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.summaryBlock}>
        <View style={styles.summaryStat}>
          <Text style={styles.summaryLabel}>
            {t("soaCar.reportTotalCollected")}
          </Text>
          <View
            style={[
              styles.summaryAmountRowWrap,
              trendHintOpen && styles.summaryAmountRowWrapElevated,
            ]}
          >
            <View style={styles.summaryAmountRow}>
              <Text style={styles.summaryAmountValue}>
                {formatFcfa(report.totalFcfa)}
              </Text>
              <Text style={styles.summaryAmountCurrency}>F</Text>
              {revenueTrend === "up" ? (
                <Pressable
                  style={styles.summaryTrendHit}
                  onPress={() => setTrendHintOpen((o) => !o)}
                  accessibilityRole="button"
                  accessibilityLabel={t("soaCar.reportTrendHintA11y")}
                  accessibilityState={{ expanded: trendHintOpen }}
                >
                  <Ionicons
                    name="trending-up"
                    size={22}
                    color={colors.accent}
                    style={styles.summaryTrendIcon}
                  />
                </Pressable>
              ) : null}
              {revenueTrend === "down" ? (
                <Pressable
                  style={styles.summaryTrendHit}
                  onPress={() => setTrendHintOpen((o) => !o)}
                  accessibilityRole="button"
                  accessibilityLabel={t("soaCar.reportTrendHintA11y")}
                  accessibilityState={{ expanded: trendHintOpen }}
                >
                  <Ionicons
                    name="trending-down"
                    size={22}
                    color={colors.destructive}
                    style={styles.summaryTrendIcon}
                  />
                </Pressable>
              ) : null}
            </View>
            {trendHintOpen &&
            revenueTrend &&
            previousDayTotal != null &&
            previousDayKey ? (
              <View style={styles.trendPill}>
                <Text
                  style={
                    revenueTrend === "up"
                      ? styles.trendPillRateUp
                      : styles.trendPillRateDown
                  }
                >
                  {growthRateLabel}
                </Text>
                <Text style={styles.trendPillCompare}>
                  {t("soaCar.reportTrendPillCompare", {
                    day: previousDayLabel,
                    amount: formatFcfa(previousDayTotal),
                  })}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.summaryStat}>
          <Text style={styles.summaryLabel}>
            {t("soaCar.reportTripsCompleted")}
          </Text>
          <Text style={styles.summaryCountValue}>
            {completedTripCountLabel}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.coursesEntry,
            pressed && styles.coursesEntryPressed,
          ]}
          onPress={() => {
            setTrendHintOpen(false);
            setTripsSheetOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("soaCar.reportOpenCoursesA11y")}
        >
          <Text style={styles.coursesEntryLabel}>
            {t("soaCar.reportTripCountLabel")}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textMuted}
          />
        </Pressable>
      </View>

      <SoaCarTripListSheet
        visible={tripsSheetOpen}
        dayLabel={selectedDayLabel}
        trips={listTrips}
        onDismiss={() => setTripsSheetOpen(false)}
        onSelectTrip={(trip) => {
          setTripsSheetOpen(false);
          setDetailTrip(trip);
        }}
      />

      <SoaCarTripReportSheet
        visible={detailTrip != null}
        trip={detailTrip}
        courseNumber={detailTrip?.courseNumber ?? null}
        onDismiss={() => setDetailTrip(null)}
        onBack={() => {
          setDetailTrip(null);
          setTripsSheetOpen(true);
        }}
      />

      {trendHintOpen ? (
        <Pressable
          style={styles.trendDismissScrim}
          onPress={() => setTrendHintOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
      ) : null}
    </SafeAreaView>
  );
}
