import {
  PocketAmountSheet,
  RenamePocketSheet,
  pocketDisplayName,
  showPocketError,
} from "@/components/pockets/PocketSheets";
import { createPocketStyles, type PocketStyles } from "@/components/pockets/pocketStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { PocketTransaction } from "@/lib/api/types";
import { formatTransactionDate } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import { deletePocketOptimistic } from "@/lib/pockets/actions";
import {
  SAVINGS_POCKET_ID,
  hydratePockets,
  savingsPocketOf,
  syncPocketTxFromNetwork,
  syncPocketsFromNetwork,
  usePocketTx,
  usePockets,
} from "@/lib/pockets/store";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import type { TFunction } from "i18next";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  InteractionManager,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const TxRow = memo(function TxRow({
  tx,
  styles,
  accent,
  ink,
  t,
}: {
  tx: PocketTransaction;
  styles: PocketStyles;
  accent: string;
  ink: string;
  t: TFunction;
}) {
  const isIn = tx.direction === "in";
  return (
    <View style={[styles.txRow, tx.id.startsWith("tmp-") && styles.txPending]}>
      <View style={styles.txIcon}>
        <Ionicons
          name={isIn ? "arrow-down" : "arrow-up"}
          size={16}
          color={isIn ? accent : ink}
        />
      </View>
      <View style={styles.txTexts}>
        <Text style={styles.txLabel} numberOfLines={1}>
          {isIn ? t("pockets.txIn") : t("pockets.txOut")}
        </Text>
        <Text style={styles.txDate}>{formatTransactionDate(tx.createdAt)}</Text>
      </View>
      <Text style={isIn ? styles.txAmountIn : styles.txAmountOut}>
        {isIn ? "+" : "−"}
        {formatFcfa(tx.amountFcfa)}
      </Text>
    </View>
  );
});

export default function PocketDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId ?? "");
  const { user, token, updateBalance } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createPocketStyles(colors), [colors]);
  const phone = user?.phone ?? "";
  const pockets = usePockets(phone);
  const txs = usePocketTx(phone, id);
  const pocket =
    id === SAVINGS_POCKET_ID
      ? savingsPocketOf(pockets)
      : (pockets.find((p) => p.id === id) ?? null);
  const [sheet, setSheet] = useState<"in" | "out" | "menu" | "rename" | null>(null);

  useEffect(() => {
    if (!phone) return;
    void hydratePockets(phone);
    if (!token) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void syncPocketTxFromNetwork(token, phone, id).catch(() => {});
      void syncPocketsFromNetwork(token, phone).catch(() => {});
    });
    return () => task.cancel();
  }, [phone, token, id]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  }, []);

  const confirmDelete = useCallback(() => {
    if (!pocket || !token) return;
    setSheet(null);
    const name = pocketDisplayName(pocket, t);
    Alert.alert(
      t("pockets.deleteTitle", { name }),
      pocket.balanceFcfa > 0
        ? t("pockets.deleteBody", { amount: formatFcfa(pocket.balanceFcfa) })
        : t("pockets.deleteBodyEmpty"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("pockets.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            goBack();
            void deletePocketOptimistic(
              {
                token,
                phone,
                balanceFcfa: user?.balanceFcfa ?? 0,
                updateBalance,
              },
              pocket,
            ).catch((e) => showPocketError(t, e));
          },
        },
      ],
    );
  }, [pocket, token, phone, user?.balanceFcfa, updateBalance, t, goBack]);

  const renderItem = useCallback(
    ({ item }: { item: PocketTransaction }) => (
      <TxRow
        tx={item}
        styles={styles}
        accent={colors.accent}
        ink={colors.textSecondary}
        t={t}
      />
    ),
    [styles, colors.accent, colors.textSecondary, t],
  );

  const name = pocket ? pocketDisplayName(pocket, t) : "";
  const isCustom = pocket?.kind === "custom";
  const canWithdraw = (pocket?.balanceFcfa ?? 0) > 0;

  const header = pocket ? (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{t("pockets.balanceLabel")}</Text>
        <View style={styles.heroAmountRow}>
          <Text style={styles.heroAmount} numberOfLines={1}>
            {formatFcfa(pocket.balanceFcfa)}
          </Text>
          <Text style={styles.heroCurrency}>{t("common.fcfa")}</Text>
        </View>
        <Text style={styles.heroLead}>
          {isCustom ? t("pockets.customLead") : t("pockets.savingsLead")}
        </Text>
        <View style={styles.heroActions}>
          <Pressable
            style={({ pressed }) => [styles.heroBtn, pressed && styles.primaryBtnPressed]}
            onPress={() => setSheet("in")}
            accessibilityRole="button"
            accessibilityLabel={t("pockets.add")}
          >
            <Ionicons name="arrow-down" size={18} color={colors.accentOn} />
            <Text style={styles.heroBtnText}>{t("pockets.add")}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.heroBtn,
              styles.heroBtnSecondary,
              !canWithdraw && styles.heroBtnDisabled,
              pressed && canWithdraw && styles.primaryBtnPressed,
            ]}
            onPress={() => setSheet("out")}
            disabled={!canWithdraw}
            accessibilityRole="button"
            accessibilityLabel={t("pockets.withdraw")}
            accessibilityState={{ disabled: !canWithdraw }}
          >
            <Ionicons name="arrow-up" size={18} color={colors.text} />
            <Text style={[styles.heroBtnText, styles.heroBtnTextSecondary]}>
              {t("pockets.withdraw")}
            </Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.historyTitle}>{t("pockets.historyTitle")}</Text>
    </>
  ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.topBtn}
          onPress={goBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {name}
        </Text>
        {isCustom ? (
          <Pressable
            style={styles.topBtn}
            onPress={() => setSheet("menu")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("pockets.moreA11y")}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.topBtn} />
        )}
      </View>

      {pocket ? (
        <FlashList
          data={txs}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <Text style={styles.empty}>{t("pockets.historyEmpty")}</Text>
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      ) : (
        <Text style={styles.empty}>{t("pockets.notFound")}</Text>
      )}

      {pocket ? (
        <>
          <PocketAmountSheet
            visible={sheet === "in" || sheet === "out"}
            onClose={() => setSheet(null)}
            direction={sheet === "out" ? "out" : "in"}
            pocket={pocket}
          />
          {isCustom ? (
            <RenamePocketSheet
              visible={sheet === "rename"}
              onClose={() => setSheet(null)}
              pocket={pocket}
            />
          ) : null}
          <Modal
            visible={sheet === "menu"}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => setSheet(null)}
          >
            <View style={styles.sheetRoot}>
              <Pressable style={styles.sheetBackdrop} onPress={() => setSheet(null)} />
              <View
                style={[
                  styles.sheetCard,
                  { paddingBottom: Math.max(insets.bottom, 16) + 8 },
                ]}
              >
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {name}
                </Text>
                <Pressable
                  style={[styles.menuItem, { marginTop: 8 }]}
                  onPress={() => setSheet("rename")}
                  accessibilityRole="button"
                >
                  <Text style={styles.menuText}>{t("pockets.rename")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.menuItem, { borderBottomWidth: 0 }]}
                  onPress={confirmDelete}
                  accessibilityRole="button"
                >
                  <Text style={[styles.menuText, styles.menuTextDanger]}>
                    {t("pockets.delete")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </>
      ) : null}
    </SafeAreaView>
  );
}
