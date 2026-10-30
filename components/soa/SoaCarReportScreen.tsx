import { createHistoryStyles } from "@/components/history/historyStyles";
import {
  createSoaReportStyles,
  createSoaTripDetailSheetStyles,
} from "@/components/soa/soaCarHomeStyles";
import { SoaCarReportShareMenu } from "@/components/soa/SoaCarReportShareMenu";
import type { StatusMenuAnchor } from "@/components/status/MyStatusRowMenu";
import { SoaReportPeriodPickerRow } from "@/components/soa/SoaReportPeriodPickerRow";
import { SoaCarTripListSheet } from "@/components/soa/SoaCarTripListSheet";
import { SoaCarTripReportSheet } from "@/components/soa/SoaCarTripReportSheet";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import { subscribeIncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import type { SoaReportTripListItem } from "@/lib/soa/soaReportTripList";
import {
  formatSoaReportDayLabel,
  formatSoaReportDayPickerLabel,
} from "@/lib/soa/formatSoaReportDayLabel";
import {
  formatSoaReportMonthPickerLabel,
  formatSoaReportWeekLabel,
  formatSoaReportWeekPickerLabel,
} from "@/lib/soa/formatSoaReportPeriodLabel";
import { soaCommerceDayKey, soaRecentDayKeys } from "@/lib/soa/soaDayKey";
import {
  aggregateSoaReportForDayKeys,
  countCompletedSoaTripsForDayKeys,
  soaDayKeysForWeek,
  soaDayKeysInMonth,
  soaMonthKeyFromDayKey,
  soaRecentMonthKeys,
  soaRecentWeekStarts,
  soaReportPrefetchDayKeysForPicker,
  soaWeekStartDayKey,
  sumSoaReportTotalForDayKeys,
  type SoaReportPeriodKind,
} from "@/lib/soa/soaReportPeriod";
import {
  getSoaDayReportSnapshot,
  subscribeSoaDayReport,
} from "@/lib/soa/soaReportCache";
import { orderSoaReportTripsForList } from "@/lib/soa/soaReportTripList";
import {
  formatSoaReportGrowthRate,
  resolveSoaReportRevenueTrend,
} from "@/lib/soa/soaReportDayTrend";
import type { SoaReportExportPayload } from "@/lib/soa/soaReportExport";
import { syncSoaDayReportFromNetwork } from "@/lib/soa/soaReportSync";
import type { SoaSeatPaymentDisplay } from "@/lib/soa/resolveSoaSeatPaymentDisplay";
import { buildSoaTripPaymentDisplays } from "@/lib/soa/soaTripDetailPayments";
import { getTransactionsSnapshot } from "@/lib/transactionsCache";
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
import {
  InteractionManager,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = {
  commerceId: string;
};

export function SoaCarReportScreen({ commerceId }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createSoaReportStyles(colors), [colors]);
  const historyStyles = useMemo(() => createHistoryStyles(colors), [colors]);
  const { token, user } = useAuth();
  const { height: windowHeight } = useWindowDimensions();
  const dayKeys = useMemo(() => soaRecentDayKeys(14), []);
  const weekStarts = useMemo(() => soaRecentWeekStarts(8), []);
  const monthKeys = useMemo(() => soaRecentMonthKeys(6), []);
  const [periodKind, setPeriodKind] = useState<SoaReportPeriodKind>("day");
  const pickerRowCount =
    periodKind === "day" ? 14 : periodKind === "week" ? 8 : 6;
  const dayDropdownMaxHeight = Math.min(
    pickerRowCount * 48,
    Math.round(windowHeight * 0.48),
  );
  const [selectedDay, setSelectedDay] = useState(() => soaCommerceDayKey());
  const [selectedWeekStart, setSelectedWeekStart] = useState(() =>
    soaWeekStartDayKey(soaCommerceDayKey()),
  );
  const [selectedMonth, setSelectedMonth] = useState(() =>
    soaMonthKeyFromDayKey(soaCommerceDayKey()),
  );
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [dayTriggerHeight, setDayTriggerHeight] = useState(40);
  const [tick, setTick] = useState(0);
  const [tripsSheetOpen, setTripsSheetOpen] = useState(false);
  const [trendHintOpen, setTrendHintOpen] = useState(false);
  const [detailTrip, setDetailTrip] = useState<SoaReportTripListItem | null>(
    null,
  );
  const [detailPayments, setDetailPayments] = useState<{
    tripId: string;
    rows: SoaSeatPaymentDisplay[];
  } | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareAnchor, setShareAnchor] = useState<StatusMenuAnchor | null>(null);
  const [exportPayload, setExportPayload] = useState<SoaReportExportPayload | null>(
    null,
  );
  const shareBtnRef = useRef<View>(null);
  const screenRootRef = useRef<View>(null);
  const focusedRef = useRef(false);
  const commerceIdRef = useRef(commerceId);
  const tickRafRef = useRef(0);
  const listTripsWarmRef = useRef<SoaReportTripListItem[] | null>(null);
  const listTripsWarmKeyRef = useRef("");
  commerceIdRef.current = commerceId;

  void tick;

  const periodDayKeys = useMemo(() => {
    if (periodKind === "day") return [selectedDay];
    if (periodKind === "week") return soaDayKeysForWeek(selectedWeekStart);
    return soaDayKeysInMonth(selectedMonth);
  }, [periodKind, selectedDay, selectedWeekStart, selectedMonth]);

  const reportTotalFcfa = useMemo(() => {
    if (periodKind === "day") {
      const snap = getSoaDayReportSnapshot(commerceId, selectedDay);
      return snap?.totalFcfa ?? 0;
    }
    return sumSoaReportTotalForDayKeys(commerceId, periodDayKeys) ?? 0;
  }, [
    periodKind,
    commerceId,
    selectedDay,
    periodDayKeys,
    tick,
  ]);

  const periodAggregateKey = useMemo(() => {
    if (periodKind === "day") return selectedDay;
    if (periodKind === "week") return selectedWeekStart;
    return selectedMonth;
  }, [periodKind, selectedDay, selectedWeekStart, selectedMonth]);

  const listTripsCacheKey = useMemo(
    () =>
      `${commerceId}|${periodKind}|${periodAggregateKey}|${periodDayKeys.join(",")}|${tick}`,
    [
      commerceId,
      periodKind,
      periodAggregateKey,
      periodDayKeys,
      tick,
    ],
  );

  const refreshVisiblePeriod = useCallback(
    (forcePrimary?: boolean) => {
      if (!token) return;
      const keys = periodDayKeys;
      if (keys.length === 0) return;
      syncSoaDayReportFromNetwork(token, commerceId, keys[0], {
        force: forcePrimary,
      });
      if (keys.length === 1) return;
      const task = InteractionManager.runAfterInteractions(() => {
        for (let i = 1; i < keys.length; i++) {
          syncSoaDayReportFromNetwork(token, commerceId, keys[i]);
        }
      });
      return () => task.cancel();
    },
    [token, commerceId, periodDayKeys],
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const cancel = refreshVisiblePeriod(true);
      return () => {
        focusedRef.current = false;
        cancel?.();
      };
    }, [refreshVisiblePeriod]),
  );

  useEffect(() => {
    return subscribeSoaDayReport(() => {
      if (tickRafRef.current) return;
      tickRafRef.current = requestAnimationFrame(() => {
        tickRafRef.current = 0;
        setTick((n) => n + 1);
      });
    });
  }, []);

  useEffect(() => {
    return subscribeIncomingPaymentFlash((event) => {
      if (!focusedRef.current) return;
      if (event.contextType !== "commerce") return;
      if (event.commerceId && event.commerceId !== commerceIdRef.current) {
        return;
      }
      refreshVisiblePeriod(true);
    });
  }, [refreshVisiblePeriod]);

  const selectedDayIndex = Math.max(0, dayKeys.indexOf(selectedDay));
  const selectedWeekIndex = Math.max(0, weekStarts.indexOf(selectedWeekStart));
  const selectedMonthIndex = Math.max(0, monthKeys.indexOf(selectedMonth));

  const selectedDayLabel = formatSoaReportDayLabel(
    selectedDay,
    selectedDayIndex,
    t,
  );

  const periodTriggerLabel = useMemo(() => {
    if (periodKind === "day") return selectedDayLabel;
    if (periodKind === "week") {
      return formatSoaReportWeekLabel(
        selectedWeekStart,
        selectedWeekIndex,
        t,
      );
    }
    if (selectedMonthIndex === 0) return t("soaCar.reportMonthThis");
    return formatSoaReportMonthPickerLabel(
      selectedMonth,
      selectedMonthIndex,
      t,
    );
  }, [
    periodKind,
    selectedDayLabel,
    selectedWeekStart,
    selectedWeekIndex,
    selectedMonth,
    selectedMonthIndex,
    t,
  ]);

  const completedTripCount = useMemo(() => {
    if (periodKind === "day") {
      const snap = getSoaDayReportSnapshot(commerceId, selectedDay);
      if (!snap) return 0;
      return snap.trips.filter((trip) => !trip.isActive).length;
    }
    return countCompletedSoaTripsForDayKeys(commerceId, periodDayKeys);
  }, [periodKind, commerceId, selectedDay, periodDayKeys, tick]);
  const completedTripCountLabel = String(completedTripCount).padStart(2, "0");

  const buildListTrips = useCallback(() => {
    const aggregated = aggregateSoaReportForDayKeys(
      commerceId,
      periodAggregateKey,
      periodDayKeys,
    );
    return orderSoaReportTripsForList(aggregated.trips);
  }, [commerceId, periodAggregateKey, periodDayKeys]);

  useEffect(() => {
    listTripsWarmRef.current = null;
    listTripsWarmKeyRef.current = "";
    const task = InteractionManager.runAfterInteractions(() => {
      const built = buildListTrips();
      listTripsWarmRef.current = built;
      listTripsWarmKeyRef.current = listTripsCacheKey;
    });
    return () => task.cancel();
  }, [buildListTrips, listTripsCacheKey]);

  const listTrips = useMemo(() => {
    if (!tripsSheetOpen && detailTrip == null) return [];
    if (listTripsWarmKeyRef.current === listTripsCacheKey && listTripsWarmRef.current) {
      return listTripsWarmRef.current;
    }
    const built = buildListTrips();
    listTripsWarmRef.current = built;
    listTripsWarmKeyRef.current = listTripsCacheKey;
    return built;
  }, [tripsSheetOpen, detailTrip, buildListTrips, listTripsCacheKey]);

  const previousPeriodTotal = useMemo(() => {
    if (periodKind === "day") {
      const previousDayKey =
        selectedDayIndex + 1 < dayKeys.length
          ? dayKeys[selectedDayIndex + 1]
          : null;
      if (!previousDayKey) return null;
      const snap = getSoaDayReportSnapshot(commerceId, previousDayKey);
      return snap ? snap.totalFcfa : null;
    }
    if (periodKind === "week") {
      const prev = weekStarts[selectedWeekIndex + 1];
      if (!prev) return null;
      return sumSoaReportTotalForDayKeys(
        commerceId,
        soaDayKeysForWeek(prev),
      );
    }
    const prevM = monthKeys[selectedMonthIndex + 1];
    if (!prevM) return null;
    return sumSoaReportTotalForDayKeys(
      commerceId,
      soaDayKeysInMonth(prevM),
    );
  }, [
    periodKind,
    commerceId,
    selectedDayIndex,
    dayKeys,
    weekStarts,
    selectedWeekIndex,
    selectedWeekStart,
    monthKeys,
    selectedMonthIndex,
    tick,
  ]);

  const revenueTrend = useMemo(
    () => resolveSoaReportRevenueTrend(reportTotalFcfa, previousPeriodTotal),
    [reportTotalFcfa, previousPeriodTotal],
  );

  useEffect(() => {
    if (!token) return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (periodKind === "day") {
        const previousDayKey =
          selectedDayIndex + 1 < dayKeys.length
            ? dayKeys[selectedDayIndex + 1]
            : null;
        if (previousDayKey) {
          syncSoaDayReportFromNetwork(token, commerceId, previousDayKey);
        }
        return;
      }
      if (periodKind === "week") {
        const prev = weekStarts[selectedWeekIndex + 1];
        if (!prev) return;
        for (const dk of soaDayKeysForWeek(prev)) {
          syncSoaDayReportFromNetwork(token, commerceId, dk);
        }
        return;
      }
      const prevM = monthKeys[selectedMonthIndex + 1];
      if (!prevM) return;
      for (const dk of soaDayKeysInMonth(prevM)) {
        syncSoaDayReportFromNetwork(token, commerceId, dk);
      }
    });
    return () => task.cancel();
  }, [
    token,
    commerceId,
    periodKind,
    selectedDayIndex,
    dayKeys,
    weekStarts,
    selectedWeekIndex,
    monthKeys,
    selectedMonthIndex,
  ]);

  useEffect(() => {
    setTrendHintOpen(false);
  }, [selectedDay, selectedWeekStart, selectedMonth, periodKind]);

  const previousPeriodLabel = useMemo(() => {
    if (periodKind === "day") {
      const previousDayKey =
        selectedDayIndex + 1 < dayKeys.length
          ? dayKeys[selectedDayIndex + 1]
          : null;
      if (!previousDayKey) return "";
      return formatSoaReportDayLabel(
        previousDayKey,
        selectedDayIndex + 1,
        t,
      );
    }
    if (periodKind === "week") {
      const prev = weekStarts[selectedWeekIndex + 1];
      if (!prev) return "";
      return formatSoaReportWeekPickerLabel(
        prev,
        selectedWeekIndex + 1,
        t,
      );
    }
    const prevM = monthKeys[selectedMonthIndex + 1];
    if (!prevM) return "";
    return formatSoaReportMonthPickerLabel(
      prevM,
      selectedMonthIndex + 1,
      t,
    );
  }, [
    periodKind,
    selectedDayIndex,
    dayKeys,
    weekStarts,
    selectedWeekIndex,
    monthKeys,
    selectedMonthIndex,
    t,
  ]);

  const growthRateLabel =
    previousPeriodTotal != null
      ? formatSoaReportGrowthRate(reportTotalFcfa, previousPeriodTotal)
      : "";

  const dayPickerRows = useMemo(
    () => {
      if (!dayPickerOpen || periodKind !== "day") return [];
      return dayKeys.map((dk, i) => {
        const daySnap = getSoaDayReportSnapshot(commerceId, dk);
        const amountFcfa =
          daySnap != null ? formatFcfa(daySnap.totalFcfa) : null;
        return {
          key: dk,
          label: formatSoaReportDayPickerLabel(dk, i, t),
          amountFcfa,
          active: dk === selectedDay,
        };
      });
    },
    [dayPickerOpen, periodKind, commerceId, dayKeys, selectedDay, tick, t],
  );

  const weekPickerRows = useMemo(
    () => {
      if (!dayPickerOpen || periodKind !== "week") return [];
      return weekStarts.map((ws, i) => {
        const total = sumSoaReportTotalForDayKeys(
          commerceId,
          soaDayKeysForWeek(ws),
        );
        return {
          key: ws,
          label: formatSoaReportWeekPickerLabel(ws, i, t),
          amountFcfa: total != null ? formatFcfa(total) : null,
          active: ws === selectedWeekStart,
        };
      });
    },
    [
      dayPickerOpen,
      periodKind,
      commerceId,
      weekStarts,
      selectedWeekStart,
      tick,
      t,
    ],
  );

  const monthPickerRows = useMemo(
    () => {
      if (!dayPickerOpen || periodKind !== "month") return [];
      return monthKeys.map((mk, i) => {
        const total = sumSoaReportTotalForDayKeys(
          commerceId,
          soaDayKeysInMonth(mk),
        );
        return {
          key: mk,
          label: formatSoaReportMonthPickerLabel(mk, i, t),
          amountFcfa: total != null ? formatFcfa(total) : null,
          active: mk === selectedMonth,
        };
      });
    },
    [dayPickerOpen, periodKind, commerceId, monthKeys, selectedMonth, tick, t],
  );

  const activePickerRows =
    periodKind === "day"
      ? dayPickerRows
      : periodKind === "week"
        ? weekPickerRows
        : monthPickerRows;

  const periodPickerA11y =
    periodKind === "day"
      ? t("soaCar.reportSelectDayA11y")
      : periodKind === "week"
        ? t("soaCar.reportSelectWeekA11y")
        : t("soaCar.reportSelectMonthA11y");

  const coursesA11y =
    periodKind === "day"
      ? t("soaCar.reportOpenCoursesA11y")
      : periodKind === "week"
        ? t("soaCar.reportOpenCoursesWeekA11y")
        : t("soaCar.reportOpenCoursesMonthA11y");

  const onPickDay = useCallback((dk: string) => {
    setSelectedDay(dk);
    setDayPickerOpen(false);
  }, []);

  const onPickWeek = useCallback((weekStart: string) => {
    setSelectedWeekStart(weekStart);
    setDayPickerOpen(false);
  }, []);

  const onPickMonth = useCallback((monthKey: string) => {
    setSelectedMonth(monthKey);
    setDayPickerOpen(false);
  }, []);

  const prewarmTripDetail = useCallback(
    (trip: SoaReportTripListItem) => {
      const unknown = t("soaCar.reportPayerUnknown");
      const rows = buildSoaTripPaymentDisplays(
        trip.seats,
        unknown,
        getTransactionsSnapshot(user?.phone),
      );
      setDetailPayments({ tripId: trip.tripId, rows });
    },
    [t, user?.phone],
  );

  useEffect(() => {
    if (!tripsSheetOpen) return;
    createSoaTripDetailSheetStyles(colors);
  }, [tripsSheetOpen, colors]);

  const openPeriodPicker = useCallback(() => {
    setTrendHintOpen(false);
    setDayPickerOpen((open) => !open);
  }, []);

  const commerceName = useMemo(() => {
    if (
      user?.activeContext?.type === "commerce" &&
      user.activeContext.commerceId === commerceId
    ) {
      const n = String(user.activeContext.name ?? "").trim();
      if (n) return n;
    }
    const hit = user?.commerces?.find((c) => c.id === commerceId);
    return (
      String(hit?.name ?? "").trim() ||
      t("soaCar.reportExportCommerceFallback")
    );
  }, [user?.activeContext, user?.commerces, commerceId, t]);

  const ensureExportPayload = useCallback((): SoaReportExportPayload => {
    const trips =
      listTripsWarmKeyRef.current === listTripsCacheKey &&
      listTripsWarmRef.current
        ? listTripsWarmRef.current
        : buildListTrips();
    return {
      commerceName,
      periodKind,
      periodLabel: periodTriggerLabel,
      totalFcfa: reportTotalFcfa,
      completedTripCount,
      trips,
      generatedAtIso: new Date().toISOString(),
    };
  }, [
    buildListTrips,
    listTripsCacheKey,
    commerceName,
    periodKind,
    periodTriggerLabel,
    reportTotalFcfa,
    completedTripCount,
  ]);

  const toggleShareMenu = useCallback(() => {
    setDayPickerOpen(false);
    setTrendHintOpen(false);
    if (shareMenuOpen) {
      setShareMenuOpen(false);
      return;
    }
    const root = screenRootRef.current;
    const btn = shareBtnRef.current;
    if (!root || !btn) return;
    root.measureInWindow((rootX, rootY) => {
      btn.measureInWindow((x, y, width, height) => {
        setShareAnchor({
          x: x - rootX,
          y: y - rootY,
          width,
          height,
        });
        setExportPayload(ensureExportPayload());
        setShareMenuOpen(true);
      });
    });
  }, [shareMenuOpen, ensureExportPayload]);

  useEffect(() => {
    if (!dayPickerOpen || !token) return;
    const task = InteractionManager.runAfterInteractions(() => {
      for (const dk of soaReportPrefetchDayKeysForPicker(periodKind)) {
        syncSoaDayReportFromNetwork(token, commerceId, dk);
      }
    });
    return () => task.cancel();
  }, [dayPickerOpen, token, commerceId, periodKind]);

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <View ref={screenRootRef} style={styles.reportScreenRoot} collapsable={false}>
      <View style={[historyStyles.header, styles.reportHeaderShell]}>
        <View style={styles.reportHeaderRow}>
          <Text style={[historyStyles.title, styles.reportHeaderTitle]}>
            {t("history.title")}
          </Text>
          <View ref={shareBtnRef} collapsable={false} style={styles.reportMenuAnchor}>
            <Pressable
              style={({ pressed }) => [
                styles.reportExportBtn,
                (shareMenuOpen || pressed) && styles.reportExportBtnActive,
              ]}
              onPress={toggleShareMenu}
              accessibilityRole="button"
              accessibilityLabel={t("soaCar.reportExportA11y")}
              accessibilityState={{ expanded: shareMenuOpen }}
            >
              <Ionicons
                name="ellipsis-vertical"
                size={20}
                color={shareMenuOpen ? colors.text : colors.textFaint}
              />
            </Pressable>
          </View>
        </View>
      </View>
      <View style={styles.periodTabs}>
        {(["day", "week", "month"] as const).map((kind) => {
          const active = periodKind === kind;
          return (
            <Pressable
              key={kind}
              style={[styles.periodTab, active && styles.periodTabActive]}
              onPress={() => {
                setDayPickerOpen(false);
                setTrendHintOpen(false);
                setShareMenuOpen(false);
                setPeriodKind(kind);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.periodTabText,
                  active && styles.periodTabTextActive,
                ]}
              >
                {kind === "day"
                  ? t("soaCar.reportPeriodDay")
                  : kind === "week"
                    ? t("soaCar.reportPeriodWeek")
                    : t("soaCar.reportPeriodMonth")}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.daySelectHost}>
        <View style={styles.daySelectWrap}>
          <Pressable
            style={styles.daySelect}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && h !== dayTriggerHeight) setDayTriggerHeight(h);
            }}
            onPress={openPeriodPicker}
            accessibilityRole="button"
            accessibilityLabel={periodPickerA11y}
            accessibilityState={{ expanded: dayPickerOpen }}
          >
            <Text style={styles.daySelectText}>{periodTriggerLabel}</Text>
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
                { top: dayTriggerHeight + 6, maxHeight: dayDropdownMaxHeight },
              ]}
            >
              <ScrollView
                style={[styles.dayDropdownScroll, { maxHeight: dayDropdownMaxHeight }]}
                contentContainerStyle={styles.dayDropdownScrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {activePickerRows.map((row) => (
                  <SoaReportPeriodPickerRow
                    key={row.key}
                    row={row}
                    styles={styles}
                    onPress={() => {
                      if (periodKind === "day") onPickDay(row.key);
                      else if (periodKind === "week") onPickWeek(row.key);
                      else onPickMonth(row.key);
                    }}
                  />
                ))}
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
                {formatFcfa(reportTotalFcfa)}
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
            previousPeriodTotal != null &&
            previousPeriodLabel ? (
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
                    day: previousPeriodLabel,
                    amount: formatFcfa(previousPeriodTotal),
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
          onPressIn={() => {
            if (listTripsWarmKeyRef.current !== listTripsCacheKey) {
              InteractionManager.runAfterInteractions(() => {
                const built = buildListTrips();
                listTripsWarmRef.current = built;
                listTripsWarmKeyRef.current = listTripsCacheKey;
              });
            }
          }}
          onPress={() => {
            setDayPickerOpen(false);
            setTrendHintOpen(false);
            setTripsSheetOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={coursesA11y}
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
        dayLabel={periodTriggerLabel}
        trips={listTrips}
        onDismiss={() => setTripsSheetOpen(false)}
        onPrewarmTrip={prewarmTripDetail}
        onSelectTrip={(trip) => {
          setDetailTrip(trip);
          requestAnimationFrame(() => setTripsSheetOpen(false));
        }}
      />

      <SoaCarTripReportSheet
        visible={detailTrip != null}
        trip={detailTrip}
        courseNumber={detailTrip?.courseNumber ?? null}
        prewarmedPayments={
          detailTrip && detailPayments?.tripId === detailTrip.tripId
            ? detailPayments.rows
            : null
        }
        onDismiss={() => {
          setDetailTrip(null);
          setDetailPayments(null);
        }}
        onBack={() => {
          setDetailTrip(null);
          setTripsSheetOpen(true);
        }}
      />

      <SoaCarReportShareMenu
        visible={shareMenuOpen}
        anchor={shareAnchor}
        periodKey={periodAggregateKey}
        payload={exportPayload}
        onDismiss={() => setShareMenuOpen(false)}
      />

      {dayPickerOpen || trendHintOpen ? (
        <Pressable
          style={
            dayPickerOpen
              ? styles.dayPickerDismissScrim
              : styles.trendDismissScrim
          }
          onPress={() => {
            setDayPickerOpen(false);
            setTrendHintOpen(false);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
      ) : null}
      </View>
    </SafeAreaView>
  );
}
