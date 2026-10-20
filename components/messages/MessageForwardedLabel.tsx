import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import React from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";

type Props = {
  mine: boolean;
  styles: ReturnType<typeof createMessagesStyles>;
};

export function MessageForwardedLabel({ mine, styles }: Props) {
  const { t } = useTranslation();
  return (
    <Text
      style={[
        styles.bubbleForwarded,
        mine ? styles.bubbleForwardedMine : styles.bubbleForwardedTheirs,
      ]}
    >
      {t("messages.forwarded")}
    </Text>
  );
}
