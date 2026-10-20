import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import { messageTranslationDisplay } from "@/lib/messages/messageTranslation";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
} from "react-native";

type Props = {
  original: string;
  translated?: string;
  mine: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createMessagesStyles>;
  textStyle: StyleProp<TextStyle>;
  childrenAfterText?: React.ReactNode;
};

function maxLineWidth(
  e: NativeSyntheticEvent<TextLayoutEventData>,
): number {
  const lines = e.nativeEvent.lines;
  if (!lines?.length) return 0;
  return Math.max(...lines.map((l) => l.width));
}

export function MessageTranslatedText({
  original,
  translated,
  mine,
  colors,
  styles,
  textStyle,
  childrenAfterText,
}: Props) {
  const { t } = useTranslation();
  const display = messageTranslationDisplay(original, translated, mine);
  const [primaryW, setPrimaryW] = useState(0);
  const [quoteW, setQuoteW] = useState(0);

  useEffect(() => {
    setPrimaryW(0);
    setQuoteW(0);
  }, [display.primary, display.original, display.showOriginalQuote]);

  const contentMinW =
    display.showOriginalQuote
      ? Math.max(primaryW, quoteW)
      : primaryW;

  return (
    <View
      style={[
        styles.translateColumn,
        contentMinW > 0 ? { minWidth: contentMinW } : null,
      ]}
    >
      {display.showTranslatedBadge ? (
        <View style={styles.translateBadgeRow}>
          <Ionicons
            name="language"
            size={14}
            color={colors.placeholder}
            accessibilityLabel={t("messages.autoTranslatedA11y")}
          />
        </View>
      ) : null}
      <Text
        style={textStyle}
        onTextLayout={(e) => {
          const w = maxLineWidth(e);
          if (w > 0) setPrimaryW((prev) => (w > prev ? w : prev));
        }}
      >
        {display.primary}
      </Text>
      {childrenAfterText}
      {display.showOriginalQuote ? (
        <View
          style={styles.translateOriginalQuote}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setQuoteW((prev) => (w > prev ? w : prev));
          }}
        >
          <View
            style={[
              styles.replyQuoteBar,
              mine ? styles.replyQuoteBarMine : styles.replyQuoteBarTheirs,
            ]}
          />
          <Text
            style={[
              styles.replyQuoteText,
              mine ? styles.replyQuoteTextMine : styles.replyQuoteTextTheirs,
              styles.translateOriginalText,
            ]}
          >
            {display.original}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
