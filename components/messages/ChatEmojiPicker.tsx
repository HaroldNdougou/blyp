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

import { CHAT_EMOJI_PANEL_HEIGHT } from "@/lib/messages/chatEmojiConstants";

export { CHAT_EMOJI_PANEL_HEIGHT };

type Props = {
  colors: ThemeColors;
  onPick: (emoji: string) => void;
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

export function ChatEmojiPicker({
  colors,
  onPick,
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

  const activeEmojis = useMemo(() => {
    if (activeId === "recent") return recent;
    const cat = categories?.find((c) => c.id === activeId);
    return cat?.emojis ?? [];
  }, [activeId, categories, recent]);

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
