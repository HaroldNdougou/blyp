import { createHistoryStyles } from "@/components/history/historyStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError } from "@/lib/api/errors";
import type { TransactionItem } from "@/lib/api/types";
import { assetUrl } from "@/lib/assets/cdn";
import {
  formatCameroonPhoneDisplay,
  formatFcfa,
} from "@/lib/format";
import {
  ensureHistoryUiRows,
  getHistoryUiRows,
  type HistoryUiRow,
} from "@/lib/history/historyUiCache";
import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { syncTransactionsFromNetwork } from "@/lib/sync/transactionsSync";
import {
  getTransactionsSnapshot,
  hydrateTransactionsCache,
} from "@/lib/transactionsCache";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
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
  ScrollView,
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

function formatDetailDateTime(iso: string): string {
  const d = new Date(iso);
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  const locale = getNumberLocale(lang);
  const date = d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
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
  const uri =
    item.type === "sent" && item.phone
      ? assetUrl(`avatars/${item.phone.replace(/\D/g, "")}.jpg`)
      : null;
  const initial = (item.name.trim().charAt(0) || "?").toUpperCase();
  const isReceived = item.type === "received";

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
        {uri ? (
          <View style={styles.avatarSmall}>
            <Image
              source={{ uri }}
              style={{ width: 44, height: 44, borderRadius: 22 }}
              cachePolicy="memory-disk"
              recyclingKey={item.id}
              transition={0}
            />
          </View>
        ) : (
          <View
            style={[
              styles.iconWrap,
              isReceived ? styles.iconWrapReceived : styles.iconWrapSent,
            ]}
          >
            {isReceived ? (
              <Ionicons name="arrow-down" size={20} color={colors.accent} />
            ) : initial !== "?" ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <Ionicons name="arrow-up" size={20} color={colors.textSecondary} />
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

  useEffect(() => {
    perfMarkStart("history_open");
    return () => {
      perfMarkEnd("history_open");
    };
  }, []);

  const applySnapshot = useCallback((items: TransactionItem[] | null) => {
    if (!items) return;
    if (items === snapshotRef.current) return;
    snapshotRef.current = items;
    setRows(ensureHistoryUiRows(phone, items) ?? []);
  }, [phone]);

  useFocusEffect(
    useCallback(() => {
      if (!token || !phone) {
        snapshotRef.current = null;
        setRows([]);
        setError(null);
        setLoading(false);
        setSelected(null);
        return;
      }
      let cancelled = false;

      /**
       * Discipline WhatsApp : au focus, si RAM déjà affichée → aucun setState.
       * Sinon peindre le cache UI sync (déjà préformaté), sync réseau en fond.
       */
      const ram = getTransactionsSnapshot(phone);
      if (ram) {
        if (ram !== snapshotRef.current) {
          applySnapshot(ram);
        }
        perfMarkEnd("history_open");
      }

      const task = InteractionManager.runAfterInteractions(() => {
        void (async () => {
          await hydrateTransactionsCache(phone);
          if (cancelled) return;
          const cached = getTransactionsSnapshot(phone);
          if (cached) {
            applySnapshot(cached);
            setLoading(false);
            setError(null);
            perfMarkEnd("history_open");
          } else if (!ram) {
            setLoading(true);
          }

          try {
            const items = await syncTransactionsFromNetwork(token, phone);
            if (cancelled) return;
            applySnapshot(items);
            setError(null);
          } catch (e) {
            if (!cancelled && !cached && !ram) {
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
      });

      return () => {
        cancelled = true;
        task.cancel();
      };
    }, [token, phone, t, applySnapshot]),
  );

  const listData = useMemo(() => buildListRows(rows), [rows]);

  const totals = useMemo(() => {
    let sent = 0;
    let received = 0;
    for (const r of rows) {
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
          typeLabel={
            item.tx.type === "received"
              ? t("history.typeReceived")
              : t("history.typeSent")
          }
        />
      );
    },
    [styles, colors, openDetail, t],
  );

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
  }, [error, loading, token, styles, colors, t]);

  const selectedPhoneDisplay = selected?.phone
    ? formatCameroonPhoneDisplay(selected.phone)
    : "";

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("history.title")}</Text>
        <Text style={styles.subtitle}>
          {rows.length > 0
            ? t("history.subtitle", { count: rows.length })
            : t("history.subtitleEmpty")}
        </Text>
        {rows.length > 0 ? (
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t("history.summarySent")}</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {formatFcfa(totals.sent)} {t("common.fcfa")}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>
                {t("history.summaryReceived")}
              </Text>
              <Text
                style={[styles.summaryValue, styles.summaryValueReceived]}
                numberOfLines={1}
              >
                {formatFcfa(totals.received)} {t("common.fcfa")}
              </Text>
            </View>
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
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 20,
          }}
          ListEmptyComponent={ListEmpty}
          drawDistance={240}
        />
      </View>

      {selected ? (
        <View style={styles.detailOverlay} pointerEvents="box-none">
          <Pressable
            style={styles.detailBackdrop}
            onPress={closeDetail}
            accessibilityRole="button"
            accessibilityLabel={t("history.close")}
          />
          <View
            style={[
              styles.detailSheet,
              { paddingBottom: Math.max(insets.bottom, 12) + 8 },
            ]}
          >
            <View style={styles.detailHandle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.detailHeader}>
                <View
                  style={[
                    styles.detailIconWrap,
                    selected.type === "received"
                      ? styles.iconWrapReceived
                      : styles.iconWrapSent,
                  ]}
                >
                  <Ionicons
                    name={
                      selected.type === "received" ? "arrow-down" : "arrow-up"
                    }
                    size={26}
                    color={
                      selected.type === "received"
                        ? colors.accent
                        : colors.textSecondary
                    }
                  />
                </View>
                <Text style={styles.detailTitle}>{t("history.detailTitle")}</Text>
                <Text
                  style={[
                    styles.detailAmount,
                    selected.type === "received"
                      ? styles.greenText
                      : styles.blackText,
                  ]}
                >
                  {selected.type === "received" ? "+" : "−"}
                  {selected.amountLabel}
                </Text>
                <Text style={styles.detailAmountCurrency}>
                  {t("common.fcfa")}
                </Text>
              </View>

              <View style={styles.detailReceipt}>
                <View style={[styles.detailRow, styles.detailRowBorder]}>
                  <Text style={styles.detailRowLabel}>
                    {t("history.detailType")}
                  </Text>
                  <Text style={styles.detailRowValue}>
                    {selected.type === "received"
                      ? t("history.typeReceived")
                      : t("history.typeSent")}
                  </Text>
                </View>
                <View style={[styles.detailRow, styles.detailRowBorder]}>
                  <Text style={styles.detailRowLabel}>
                    {t("history.detailStatus")}
                  </Text>
                  <Text
                    style={[styles.detailRowValue, styles.detailStatusOk]}
                  >
                    {t("history.statusOk")}
                  </Text>
                </View>
                <View style={[styles.detailRow, styles.detailRowBorder]}>
                  <Text style={styles.detailRowLabel}>
                    {t("history.detailTo")}
                  </Text>
                  <Text style={styles.detailRowValue}>{selected.name}</Text>
                </View>
                {selectedPhoneDisplay ? (
                  <View style={[styles.detailRow, styles.detailRowBorder]}>
                    <Text style={styles.detailRowLabel}>
                      {t("history.detailPhone")}
                    </Text>
                    <Text
                      style={[
                        styles.detailRowValue,
                        styles.detailRowValueMuted,
                      ]}
                    >
                      +237 {selectedPhoneDisplay}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.detailRow, styles.detailRowBorder]}>
                  <Text style={styles.detailRowLabel}>
                    {t("history.detailDate")}
                  </Text>
                  <Text
                    style={[styles.detailRowValue, styles.detailRowValueMuted]}
                  >
                    {formatDetailDateTime(selected.createdAt)}
                  </Text>
                </View>
                {selected.reference ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailRowLabel}>
                      {t("history.detailRef")}
                    </Text>
                    <Text
                      style={[
                        styles.detailRowValue,
                        styles.detailRowValueMuted,
                      ]}
                      selectable
                    >
                      {selected.reference}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.detailCloseBtn,
                  pressed && styles.detailCloseBtnPressed,
                ]}
                onPress={closeDetail}
                accessibilityRole="button"
                accessibilityLabel={t("history.close")}
              >
                <Text style={styles.detailCloseBtnText}>
                  {t("history.close")}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
