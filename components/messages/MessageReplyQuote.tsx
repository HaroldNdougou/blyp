import type { MessageReplyTo } from "@/lib/api/types";
import { useTheme } from "@/contexts/ThemeContext";
import {
  replyAuthorName,
  replySnippetText,
} from "@/lib/messages/replyPreview";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

type QuoteStyles = {
  replyQuote: StyleProp<ViewStyle>;
  replyQuoteBody: StyleProp<ViewStyle>;
  replyQuoteBar: StyleProp<ViewStyle>;
  replyQuoteBarMine: StyleProp<ViewStyle>;
  replyQuoteBarTheirs: StyleProp<ViewStyle>;
  replyQuoteAuthor: StyleProp<TextStyle>;
  replyQuoteAuthorMine: StyleProp<TextStyle>;
  replyQuoteAuthorTheirs: StyleProp<TextStyle>;
  replyQuoteText: StyleProp<TextStyle>;
  replyQuoteTextMine: StyleProp<TextStyle>;
  replyQuoteTextTheirs: StyleProp<TextStyle>;
  replyComposer: StyleProp<ViewStyle>;
  replyComposerBar: StyleProp<ViewStyle>;
  replyComposerBody: StyleProp<ViewStyle>;
  replyComposerAuthor: StyleProp<TextStyle>;
  replyComposerSnippet: StyleProp<TextStyle>;
  replyComposerClose: StyleProp<ViewStyle>;
};

export function MessageReplyQuote({
  replyTo,
  mine,
  myId,
  peerName,
  styles,
  onPress,
}: {
  replyTo: MessageReplyTo;
  mine: boolean;
  myId: string | null;
  peerName: string;
  styles: QuoteStyles;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const author = replyAuthorName(replyTo, myId, peerName, t);
  const snippet = replySnippetText(replyTo, t);

  const inner = (
    <View style={styles.replyQuote}>
      <View
        style={[
          styles.replyQuoteBar,
          mine ? styles.replyQuoteBarMine : styles.replyQuoteBarTheirs,
        ]}
      />
      <View style={styles.replyQuoteBody}>
        <Text
          style={[
            styles.replyQuoteAuthor,
            mine ? styles.replyQuoteAuthorMine : styles.replyQuoteAuthorTheirs,
          ]}
          numberOfLines={1}
        >
          {author}
        </Text>
        <Text
          style={[
            styles.replyQuoteText,
            mine ? styles.replyQuoteTextMine : styles.replyQuoteTextTheirs,
          ]}
          numberOfLines={2}
        >
          {snippet}
        </Text>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        style={{ alignSelf: "stretch" }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("messages.replyJumpA11y", { author, snippet })}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

export function ComposerReplyBar({
  replyTo,
  myId,
  peerName,
  styles,
  onClose,
}: {
  replyTo: MessageReplyTo;
  myId: string | null;
  peerName: string;
  styles: QuoteStyles;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const author = replyAuthorName(replyTo, myId, peerName, t);
  const snippet = replySnippetText(replyTo, t);

  return (
    <View style={styles.replyComposer}>
      <View style={styles.replyComposerBar} />
      <View style={styles.replyComposerBody}>
        <Text style={styles.replyComposerAuthor} numberOfLines={1}>
          {author}
        </Text>
        <Text style={styles.replyComposerSnippet} numberOfLines={2}>
          {snippet}
        </Text>
      </View>
      <Pressable
        style={styles.replyComposerClose}
        onPress={onClose}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t("messages.replyCancelA11y")}
      >
        <Ionicons name="close" size={22} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}
