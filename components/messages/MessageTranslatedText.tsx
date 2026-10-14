import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import { messageTranslationDisplay } from "@/lib/messages/messageTranslation";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type TextStyle } from "react-native";

type Props = {
  original: string;
  translated?: string;
  mine: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createMessagesStyles>;
  textStyle: StyleProp<TextStyle>;
  childrenAfterText?: React.ReactNode;
};

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

  return (
    <View>
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
      <Text style={textStyle}>{display.primary}</Text>
      {childrenAfterText}
      {display.showOriginalQuote ? (
        <View style={styles.translateOriginalQuote}>
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
