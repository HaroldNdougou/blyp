import {
  loadChatEmojiCategories,
  type ChatEmojiCategory,
  type ChatEmojiCategoryId,
} from "@/lib/messages/chatEmojiCatalog";
import {
  getRecentChatEmojis,
  subscribeRecentChatEmojis,
} from "@/lib/messages/recentChatEmojis";
import type { ThemeColors } from "@/lib/theme/colors";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { formatFcfa } from "@/lib/formatFcfa";
import { CHAT_EMOJI_PANEL_HEIGHT } from "@/lib/messages/chatEmojiConstants";
import type { ChatMoneyDenom } from "@/lib/messages/chatMoneyDenoms";

export { CHAT_EMOJI_PANEL_HEIGHT };

type Props = {
  colors: ThemeColors;
  onPick: (emoji: string) => void;
  /** Tap fruit + montant → message money (FCFA). */
  onPickMoney?: (denom: ChatMoneyDenom) => void;
  backgroundColor: string;
  borderColor: string;
};

function useRecentEmojis(): string[] {
  return useSyncExternalStore(
    subscribeRecentChatEmojis,
    getRecentChatEmojis,
    getRecentChatEmojis,
  );
}

function RecentEmojiSection({
  recent,
  cell,
  borderColor,
  colors,
  onPick,
}: {
  recent: string[];
  cell: number;
  borderColor: string;
  colors: ThemeColors;
  onPick: (emoji: string) => void;
}) {
  const { t } = useTranslation();
  if (recent.length === 0) return null;
  return (
    <View
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: borderColor,
        paddingBottom: 6,
        marginBottom: 4,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: colors.textMuted,
          marginLeft: 10,
          marginBottom: 4,
        }}
      >
        {t("messages.emojiCat.recent")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 4 }}>
        {recent.map((item, index) => (
          <Pressable
            key={`${item}-${index}`}
            style={{
              width: cell,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={() => onPick(item)}
            accessibilityLabel={t("messages.emojiPickA11y", { emoji: item })}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 28, lineHeight: 32 }}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MoneySectionLabel({
  labelKey,
  colors,
  first,
}: {
  labelKey: string;
  colors: ThemeColors;
  /** Premier bloc du panneau Argent (pas de marge haute). */
  first?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: "600",
        color: colors.textMuted,
        marginLeft: 10,
        marginTop: first ? 0 : 6,
        marginBottom: 4,
      }}
    >
      {t(labelKey)}
    </Text>
  );
}

function MoneyDenomGrid({
  denoms,
  colors,
  onPickMoney,
}: {
  denoms: ChatMoneyDenom[];
  colors: ThemeColors;
  onPickMoney: (denom: ChatMoneyDenom) => void;
}) {
  if (denoms.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: 8,
        gap: 10,
        rowGap: 12,
      }}
    >
      {denoms.map((denom) => (
        <MoneyDenomPickerCell
          key={denom.id}
          denom={denom}
          colors={colors}
          onPress={() => onPickMoney(denom)}
        />
      ))}
    </View>
  );
}

function MoneyEmojiPanel({
  moneyDenoms,
  moneyEmojis,
  emojiCell,
  colors,
  borderColor,
  onPick,
  onPickMoney,
}: {
  moneyDenoms: ChatMoneyDenom[];
  moneyEmojis: string[];
  emojiCell: number;
  colors: ThemeColors;
  borderColor: string;
  onPick: (emoji: string) => void;
  onPickMoney: (denom: ChatMoneyDenom) => void;
}) {
  const { t } = useTranslation();

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {moneyDenoms.length > 0 ? (
        <MoneySectionLabel
          labelKey="messages.emojiMoneySectionFruits"
          colors={colors}
          first
        />
      ) : null}
      <MoneyDenomGrid
        denoms={moneyDenoms}
        colors={colors}
        onPickMoney={onPickMoney}
      />
      {moneyEmojis.length > 0 ? (
        <>
          <MoneySectionLabel
            labelKey="messages.emojiMoneySectionExpressions"
            colors={colors}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              paddingHorizontal: 4,
              borderTopWidth: moneyEmojis.length ? StyleSheet.hairlineWidth : 0,
              borderTopColor: borderColor,
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            {moneyEmojis.map((item, index) => (
              <Pressable
                key={`${item}-${index}`}
                style={{
                  width: emojiCell,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => onPick(item)}
                accessibilityLabel={t("messages.emojiPickA11y", { emoji: item })}
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 28, lineHeight: 32 }}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

export function ChatEmojiPicker({
  colors,
  onPick,
  onPickMoney,
  backgroundColor,
  borderColor,
}: Props) {
  const { t } = useTranslation();
  const { width: screenW } = useWindowDimensions();
  const cell = Math.floor((screenW - 8) / 8);
  const recent = useRecentEmojis();
  const [categories, setCategories] = useState<ChatEmojiCategory[] | null>(
    null,
  );
  const [activeId, setActiveId] =
    useState<ChatEmojiCategoryId>("smileys_emotion");

  useEffect(() => {
    let alive = true;
    void loadChatEmojiCategories().then((cats) => {
      if (alive) setCategories(cats);
    });
    return () => {
      alive = false;
    };
  }, []);

  const activeCategory = useMemo(
    () => categories?.find((c) => c.id === activeId),
    [activeId, categories],
  );

  const activeEmojis = useMemo(() => {
    if (activeId === "recent") return recent;
    return activeCategory?.emojis ?? [];
  }, [activeId, activeCategory, recent]);

  const activeMoneyDenoms = activeCategory?.moneyDenoms ?? [];
  const isMoneyTab = activeId === "money" && activeMoneyDenoms.length > 0;

  const showRecentHeader =
    activeId !== "recent" && recent.length > 0;

  const tabs = useMemo(() => {
    const base = categories ?? [];
    return [
      {
        id: "recent" as ChatEmojiCategoryId,
        labelKey: "messages.emojiCat.recent",
        icon: "time-outline",
      },
      ...base.map((c) => ({
        id: c.id,
        labelKey: c.labelKey,
        icon: c.icon,
      })),
    ];
  }, [categories]);

  const renderEmoji = useCallback(
    ({ item }: { item: string }) => (
      <Pressable
        style={{
          width: cell,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
        }}
        onPress={() => onPick(item)}
        accessibilityLabel={t("messages.emojiPickA11y", { emoji: item })}
        accessibilityRole="button"
      >
        <Text style={{ fontSize: 28, lineHeight: 32 }}>{item}</Text>
      </Pressable>
    ),
    [cell, onPick, t],
  );

  const listHeader = useMemo(
    () =>
      showRecentHeader
        ? (
            <RecentEmojiSection
              recent={recent}
              cell={cell}
              borderColor={borderColor}
              colors={colors}
              onPick={onPick}
            />
          )
        : null,
    [showRecentHeader, recent, cell, borderColor, colors, onPick],
  );

  return (
    <View
      style={{
        height: CHAT_EMOJI_PANEL_HEIGHT,
        backgroundColor,
        borderTopWidth: 1,
        borderTopColor: borderColor,
      }}
    >
      {!categories ? (
        <View
          style={{
            flex: 1,
            minHeight: CHAT_EMOJI_PANEL_HEIGHT - 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : activeEmojis.length === 0 && activeId === "recent" ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 14,
              textAlign: "center",
            }}
          >
            {t("messages.emojiRecentEmpty")}
          </Text>
        </View>
      ) : isMoneyTab && onPickMoney ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          <MoneyEmojiPanel
            moneyDenoms={activeMoneyDenoms}
            moneyEmojis={activeEmojis}
            emojiCell={cell}
            colors={colors}
            borderColor={borderColor}
            onPick={onPick}
            onPickMoney={onPickMoney}
          />
        </View>
      ) : (
        <View style={{ flex: 1, minHeight: 0 }}>
          <FlashList
            data={activeEmojis}
            numColumns={8}
            keyExtractor={(item, index) => `${activeId}-${item}-${index}`}
            renderItem={renderEmoji}
            ListHeaderComponent={listHeader}
            contentContainerStyle={{ paddingHorizontal: 4, paddingTop: 8 }}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: borderColor,
          maxHeight: 48,
        }}
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: 6,
          gap: 2,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveId(tab.id)}
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 22,
                backgroundColor: active ? colors.surfaceMuted : "transparent",
              }}
              accessibilityLabel={t(tab.labelKey)}
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={tab.icon as keyof typeof Ionicons.glyphMap}
                size={22}
                color={active ? colors.accent : colors.textMuted}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function compactMoneyDenomLabel(amountFcfa: number): string {
  if (amountFcfa >= 10_000) return "10k";
  if (amountFcfa >= 1000) {
    const k = amountFcfa / 1000;
    return Number.isInteger(k) ? `${k}k` : formatFcfa(amountFcfa);
  }
  return String(amountFcfa);
}

function MoneyDenomPickerCell({
  denom,
  colors,
  onPress,
}: {
  denom: ChatMoneyDenom;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const amountLabel = compactMoneyDenomLabel(denom.amountFcfa);
  const fruitName = t(denom.fruitLabelKey);

  return (
    <Pressable
      style={{ alignSelf: "flex-start" }}
      onPress={onPress}
      accessibilityLabel={t("messages.emojiMoneyPickA11y", {
        amount: formatFcfa(denom.amountFcfa),
        fruit: fruitName,
      })}
      accessibilityRole="button"
    >
      {({ pressed }) => (
        <View
          style={[
            { alignItems: "center", opacity: pressed ? 0.72 : 1 },
            pressed ? { transform: [{ scale: 0.96 }] } : null,
          ]}
        >
          <Text
            style={{ fontSize: 34, lineHeight: 38, marginBottom: -2 }}
            accessibilityElementsHidden
          >
            {denom.fruitEmoji}
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: pressed
                ? colors.chatMoneyPillPressedBackground
                : colors.chatMoneyPillText,
              textAlign: "center",
              marginTop: 1,
            }}
            numberOfLines={1}
          >
            {amountLabel}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
