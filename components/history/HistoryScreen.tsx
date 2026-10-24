import { createHistoryStyles } from "@/components/history/historyStyles";
import { PaymentReceiptScreen } from "@/components/pay/PaymentReceiptScreen";
import { SoaCarReportScreen } from "@/components/soa/SoaCarReportScreen";
import { useAuth } from "@/contexts/AuthContext";
import { isSoaCarCategory } from "@/lib/soa/soaCar";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError } from "@/lib/api/errors";
import type { TransactionItem } from "@/lib/api/types";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { formatFcfa } from "@/lib/format";
import {
  ensureHistoryUiRows,
  getHistoryUiRows,
  type HistoryUiRow,
} from "@/lib/history/historyUiCache";
import { historyTxTypeLabel } from "@/lib/history/historyTypeLabel";
import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { syncTransactionsFromNetwork } from "@/lib/sync/transactionsSync";
import {
  getTransactionsSnapshot,
  hydrateTransactionsCache,
  subscribeTransactionsCache,
  transactionSnapshotsEqual,
} from "@/lib/transactionsCache";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect } from "@react-navigation/native";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type HistoryRow = HistoryUiRow;

type ListRow =
  | { kind: "header"; id: string; title: string }
  | { kind: "tx"; id: string; tx: HistoryRow };

/** Fenêtre UI : 10 au départ, +10 à chaque « Voir plus ». */
const HISTORY_PAGE_SIZE = 10;

type HistoryFilter = "all" | "sent" | "received";

function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatSectionTitle(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (sameDay) return i18n.t("dates.today");
  if (isYesterday) return i18n.t("dates.yesterday");
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  return d.toLocaleDateString(getNumberLocale(lang), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function buildListRows(rows: HistoryRow[]): ListRow[] {
  const out: ListRow[] = [];
  let lastDay: string | null = null;
  for (const tx of rows) {
    const dk = dayKey(tx.createdAt);
    if (dk !== lastDay) {
      lastDay = dk;
      out.push({
        kind: "header",
        id: `h-${dk}`,
        title: formatSectionTitle(tx.createdAt),
      });
    }
    out.push({ kind: "tx", id: tx.id, tx });
  }
  return out;
}

const HistoryRowItem = memo(function HistoryRowItem({
  item,
  styles,
  colors,
  onPress,
  typeLabel,
}: {
  item: HistoryRow;
  styles: ReturnType<typeof createHistoryStyles>;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: (row: HistoryRow) => void;
  typeLabel: string;
}) {
  const isReceived = item.type === "received";
  const initial = (item.name.trim().charAt(0) || "?").toUpperCase();

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.transactionItem,
        pressed && styles.transactionItemPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${typeLabel}, ${item.name}, ${isReceived ? "+" : "-"}${item.amountLabel}`}
    >
      <View style={styles.leftContent}>
        {item.type === "sent" && item.phone ? (
          <PeerAvatar
            name={item.name}
            phone={item.phone}
            localUri={contactPhotoUriForPhone(item.phone)}
            size={36}
            style={styles.avatarSmall}
            recyclingKey={item.id}
          />
        ) : (
          <View
            style={[
              styles.iconWrap,
              isReceived ? styles.iconWrapReceived : styles.iconWrapSent,
            ]}
          >
            {isReceived ? (
              <Text style={[styles.avatarText, { color: colors.accent }]}>↓</Text>
            ) : initial !== "?" ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <Text
                style={[styles.avatarText, { color: colors.textSecondary }]}
              >
                ↑
              </Text>
            )}
          </View>
        )}
        <View style={styles.metaCol}>
          <Text style={styles.nameText} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.metaLine} numberOfLines={1}>
            {item.dateLabel}
          </Text>
          {item.reference ? (
            <Text style={styles.refText} numberOfLines={1}>
              {item.reference}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.rightCol}>
        <Text
          style={[
            styles.amountText,
            isReceived ? styles.greenText : styles.blackText,
          ]}
          numberOfLines={1}
        >
          {isReceived ? "+" : "−"}
          {item.amountLabel}
        </Text>
        <Text style={styles.amountCurrency}>FCFA</Text>
        <View style={styles.typeChip}>
          <Text style={styles.typeChipText}>{typeLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
});

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const soaCommerceId =
    user?.activeContext?.type === "commerce"
      ? user.activeContext.commerceId
      : null;
  const soaCategory =
    user?.activeContext?.type === "commerce"
      ? user.activeContext.category ??
        user.commerces?.find((c) => c.id === soaCommerceId)?.category ??
        null
      : null;
  const showSoaReport =
    Boolean(soaCommerceId) && isSoaCarCategory(soaCategory);
  const phone = user?.phone ?? "";
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createHistoryStyles(colors), [colors]);
  const [rows, setRows] = useState<HistoryRow[]>(() => {
    if (!phone) return [];
    return (
      getHistoryUiRows(phone) ??
      ensureHistoryUiRows(phone, getTransactionsSnapshot(phone)) ??
      []
    );
  });
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [loading, setLoading] = useState(() => {
    if (!phone) return false;
    return getHistoryUiRows(phone) == null && getTransactionsSnapshot(phone) == null;
  });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoryRow | null>(null);
  /** Même référence snapshot tx ⇒ zéro setState au focus. */
  const snapshotRef = useRef<TransactionItem[] | null>(
    phone ? getTransactionsSnapshot(phone) : null,
  );
  const phoneRef = useRef(phone);

  const applySnapshot = useCallback((items: TransactionItem[] | null) => {
    if (!items) return;
    if (items === snapshotRef.current) return;
    const prev = snapshotRef.current;
    if (prev && transactionSnapshotsEqual(prev, items)) {
      /** Même contenu, nouvelle ref (sync) → pas de re-render liste. */
      snapshotRef.current = items;
      return;
    }
    snapshotRef.current = items;
    setRows(ensureHistoryUiRows(phone, items) ?? []);
  }, [phone]);

  useEffect(() => {
    if (phoneRef.current !== phone) {
      phoneRef.current = phone;
      setVisibleCount(HISTORY_PAGE_SIZE);
      setFilter("all");
    }
  }, [phone]);

  /** Pay merge → liste déjà à jour avant le clic onglet (1 flash). */
  useEffect(() => {
    if (!phone) return;
    return subscribeTransactionsCache((p, items) => {
      if (p !== phone) return;
      applySnapshot(items);
      setLoading(false);
      setError(null);
    });
  }, [phone, applySnapshot]);

  useFocusEffect(
    useCallback(() => {
      perfMarkStart("history_open");
      if (!token || !phone) {
        perfMarkEnd("history_open");
        snapshotRef.current = null;
        setRows([]);
        setVisibleCount(HISTORY_PAGE_SIZE);
        setFilter("all");
        setError(null);
        setLoading(false);
        setSelected(null);
        return;
      }
      let cancelled = false;

      /**
       * WhatsApp : peindre RAM tout de suite.
       * Sync réseau en fond — jamais de spinner si le cache a déjà des lignes.
       */
      const ram = getTransactionsSnapshot(phone);
      if (ram) {
        applySnapshot(ram);
        setLoading(false);
        setError(null);
        perfMarkEnd("history_open");
      }

      void (async () => {
        if (!ram) {
          await hydrateTransactionsCache(phone);
          if (cancelled) return;
          const cached = getTransactionsSnapshot(phone);
          if (cached) {
            applySnapshot(cached);
            setLoading(false);
            setError(null);
            perfMarkEnd("history_open");
          } else {
            setLoading(true);
          }
        }

        const syncNet = () => {
          void (async () => {
            try {
              const items = await syncTransactionsFromNetwork(token, phone);
              if (cancelled) return;
              applySnapshot(items);
              setError(null);
            } catch (e) {
              if (
                !cancelled &&
                !getTransactionsSnapshot(phone) &&
                !ram
              ) {
                setError(
                  e instanceof ApiError ? e.message : t("history.loadFailed"),
                );
                setRows([]);
                snapshotRef.current = null;
              }
            } finally {
              if (!cancelled) {
                setLoading(false);
                perfMarkEnd("history_open");
              }
            }
          })();
        };

        if (ram) {
          InteractionManager.runAfterInteractions(syncNet);
        } else {
          syncNet();
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [token, phone, t, applySnapshot]),
  );

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.type === filter);
  }, [rows, filter]);
  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount],
  );
  const hasMore = visibleCount < filteredRows.length;
  const listData = useMemo(() => buildListRows(visibleRows), [visibleRows]);

  const onFilterPress = useCallback((next: "sent" | "received") => {
    setFilter((prev) => (prev === next ? "all" : next));
    setVisibleCount(HISTORY_PAGE_SIZE);
  }, []);

  const totals = useMemo(() => {
    let sent = 0;
    let received = 0;
    for (const r of rows) {
      if (r.internal) continue;
      if (r.type === "sent") sent += r.amountFcfa;
      else received += r.amountFcfa;
    }
    return { sent, received };
  }, [rows]);

  const openDetail = useCallback((row: HistoryRow) => {
    setSelected(row);
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null);
  }, []);

  const onSeeMore = useCallback(() => {
    setVisibleCount((n) => n + HISTORY_PAGE_SIZE);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.kind === "header") {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{item.title}</Text>
          </View>
        );
      }
      return (
        <HistoryRowItem
          item={item.tx}
          styles={styles}
          colors={colors}
          onPress={openDetail}
          typeLabel={historyTxTypeLabel(item.tx, t)}
        />
      );
    },
    [styles, colors, openDetail, t],
  );

  const ListFooter = useMemo(() => {
    if (!hasMore) return null;
    return (
      <View style={styles.seeMoreWrap}>
        <Pressable
          style={({ pressed }) => [
            styles.seeMoreBtn,
            pressed && styles.seeMoreBtnPressed,
          ]}
          onPress={onSeeMore}
          accessibilityRole="button"
          accessibilityLabel={t("history.seeMore")}
        >
          <Text style={styles.seeMoreText}>{t("history.seeMore")}</Text>
        </Pressable>
      </View>
    );
  }, [hasMore, styles, onSeeMore, t]);

  const ListEmpty = useMemo(() => {
    if (error) {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons
              name="cloud-offline-outline"
              size={28}
              color={colors.textMuted}
            />
          </View>
          <Text style={styles.emptyTitle}>{t("history.loadFailed")}</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      );
    }
    if (loading) {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      );
    }
    if (!token) {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons
              name="lock-closed-outline"
              size={26}
              color={colors.textMuted}
            />
          </View>
          <Text style={styles.emptyTitle}>{t("history.signInRequired")}</Text>
        </View>
      );
    }
    if (filter === "sent") {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons
              name="arrow-up-outline"
              size={28}
              color={colors.textMuted}
            />
          </View>
          <Text style={styles.emptyTitle}>{t("history.emptySent")}</Text>
          <Text style={styles.emptyText}>{t("history.emptySentHint")}</Text>
        </View>
      );
    }
    if (filter === "received") {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons
              name="arrow-down-outline"
              size={28}
              color={colors.textMuted}
            />
          </View>
          <Text style={styles.emptyTitle}>{t("history.emptyReceived")}</Text>
          <Text style={styles.emptyText}>{t("history.emptyReceivedHint")}</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <Ionicons
            name="swap-vertical-outline"
            size={28}
            color={colors.textMuted}
          />
        </View>
        <Text style={styles.emptyTitle}>{t("history.empty")}</Text>
        <Text style={styles.emptyText}>{t("history.emptyHint")}</Text>
      </View>
    );
  }, [error, loading, token, filter, styles, colors, t]);

  if (showSoaReport && soaCommerceId) {
    return <SoaCarReportScreen commerceId={soaCommerceId} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("history.title")}</Text>
        <Text style={styles.subtitle}>
          {filteredRows.length > 0
            ? t("history.subtitle", { count: visibleRows.length })
            : t("history.subtitleEmpty")}
        </Text>
        {rows.length > 0 ? (
          <View style={styles.summaryRow}>
            <Pressable
              style={({ pressed }) => [
                styles.summaryCard,
                filter === "sent" && styles.summaryCardActive,
                pressed && styles.summaryCardPressed,
              ]}
              onPress={() => onFilterPress("sent")}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === "sent" }}
              accessibilityLabel={t("history.filterSentA11y")}
            >
              <Text style={styles.summaryLabel}>{t("history.summarySent")}</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {formatFcfa(totals.sent)}
              </Text>
              <Text style={styles.summaryCurrency}>{t("common.fcfa")}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.summaryCard,
                filter === "received" && styles.summaryCardActive,
                pressed && styles.summaryCardPressed,
              ]}
              onPress={() => onFilterPress("received")}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === "received" }}
              accessibilityLabel={t("history.filterReceivedA11y")}
            >
              <Text style={styles.summaryLabel}>
                {t("history.summaryReceived")}
              </Text>
              <Text
                style={[styles.summaryValue, styles.summaryValueReceived]}
                numberOfLines={1}
              >
                {formatFcfa(totals.received)}
              </Text>
              <Text style={styles.summaryCurrency}>{t("common.fcfa")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.listFlex}>
        <FlashList
          data={listData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          getItemType={(item) => item.kind}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: insets.bottom + 16,
          }}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          drawDistance={240}
        />
      </View>
    </SafeAreaView>

      {selected ? (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 20 }]}>
          <PaymentReceiptScreen
            receipt={{
              amountFcfa: selected.amountFcfa,
              counterpartyName: selected.name,
              counterpartyPhone: selected.phone,
              paidAt: selected.createdAt,
              reference: selected.reference,
              direction: selected.type,
            }}
            onClose={closeDetail}
          />
        </View>
      ) : null}
    </View>
  );
}
