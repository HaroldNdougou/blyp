import type { ChatMessage, MessageReaction } from "@/lib/api/types";
import { QUICK_REACTIONS } from "@/lib/messages/reactionSync";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export { QUICK_REACTIONS };

type Styles = {
  reactPicker: StyleProp<ViewStyle>;
  reactPickerRow: StyleProp<ViewStyle>;
  reactPickBtn: StyleProp<ViewStyle>;
  reactPickEmoji: StyleProp<TextStyle>;
  reactThanksBtn: StyleProp<ViewStyle>;
  reactThanksText: StyleProp<TextStyle>;
  reactBadgeRow: StyleProp<ViewStyle>;
  reactBadge: StyleProp<ViewStyle>;
  reactBadgeMine: StyleProp<ViewStyle>;
  reactBadgeEmoji: StyleProp<TextStyle>;
};

type Group = { emoji: string; count: number; mine: boolean };

function groupReactions(
  reactions: MessageReaction[] | undefined,
  myId: string | null,
): Group[] {
  if (!reactions || reactions.length === 0) return [];
  const map = new Map<string, Group>();
  for (const r of reactions) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (myId && r.userId === myId) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

export function ReactionPicker({
  styles,
  onPick,
  thanksLabel,
  onThanks,
  showReactions = true,
}: {
  styles: Styles;
  onPick: (emoji: string) => void;
  thanksLabel?: string;
  onThanks?: () => void;
  showReactions?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.reactPicker} collapsable={false}>
      {showReactions ? (
        <View style={styles.reactPickerRow} collapsable={false}>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              style={styles.reactPickBtn}
              onPressIn={() => onPick(emoji)}
              accessibilityRole="button"
              accessibilityLabel={t("messages.reactPickA11y", { emoji })}
              hitSlop={8}
            >
              <Text style={styles.reactPickEmoji}>{emoji}</Text>
            </Pressable>
          ))}
          {thanksLabel && onThanks ? (
            <Pressable
              style={styles.reactThanksBtn}
              onPressIn={onThanks}
              accessibilityRole="button"
              accessibilityLabel={t("messages.thanksA11y")}
              hitSlop={8}
            >
              <Text style={styles.reactThanksText}>{thanksLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ReactionBadge({
  message,
  myId,
  styles,
  onToggle,
}: {
  message: ChatMessage;
  myId: string | null;
  styles: Styles;
  onToggle: (emoji: string) => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupReactions(message.reactions, myId),
    [message.reactions, myId],
  );
  if (groups.length === 0) return null;
  return (
    <View style={styles.reactBadgeRow}>
      {groups.map((g) => (
        <Pressable
          key={g.emoji}
          style={[styles.reactBadge, g.mine && styles.reactBadgeMine]}
          onPress={() => onToggle(g.emoji)}
          accessibilityRole="button"
          accessibilityLabel={
            g.mine
              ? t("messages.reactRemoveA11y")
              : t("messages.reactPickA11y", { emoji: g.emoji })
          }
        >
          <Text style={styles.reactBadgeEmoji}>
            {g.emoji}
            {g.count > 1 ? ` ${g.count}` : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
