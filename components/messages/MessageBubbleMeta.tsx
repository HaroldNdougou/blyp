import {
  DeletedMessageTick,
  MessageTicks,
} from "@/components/messages/MessageTicks";
import { formatMessageTime } from "@/lib/format";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export type BubbleTick = "sending" | "read" | "delivered" | "sent";

type MetaStyles = {
  bubbleMeta: StyleProp<ViewStyle>;
  bubbleMetaRow: StyleProp<ViewStyle>;
  bubbleMetaTime: StyleProp<TextStyle>;
  bubbleMetaTimeMine: StyleProp<TextStyle>;
  bubbleMetaTimeTheirs: StyleProp<TextStyle>;
  bubbleMetaCheck: StyleProp<TextStyle>;
  imageMetaTime: StyleProp<TextStyle>;
};

function tickA11y(tick: BubbleTick, t: (key: string) => string): string {
  if (tick === "sending") return t("messages.sendingA11y");
  if (tick === "read") return t("messages.readA11y");
  if (tick === "delivered") return t("messages.deliveredA11y");
  return t("messages.sentA11y");
}

/** Heure (+ coches) en bas à droite de la bulle — texte, money, vocal, légende image. */
export function MessageBubbleMetaRow({
  createdAt,
  mine,
  tick,
  colors,
  styles,
  imageOverlay,
  bare,
  deletedForAll,
}: {
  createdAt: string;
  mine: boolean;
  tick: BubbleTick | null;
  colors: ThemeColors;
  styles: MetaStyles;
  imageOverlay?: boolean;
  bare?: boolean;
  /** Bulle « Vous avez supprimé ce message » — pas de coche. */
  deletedForAll?: boolean;
}) {
  const { t } = useTranslation();
  const time = formatMessageTime(createdAt);
  if (!time) return null;

  const timeStyle = imageOverlay
    ? styles.imageMetaTime
    : mine
      ? styles.bubbleMetaTimeMine
      : styles.bubbleMetaTimeTheirs;

  const showDeletedTick = Boolean(mine && deletedForAll);
  const tickLabel = showDeletedTick
    ? ""
    : mine && tick
      ? tickA11y(tick, t)
      : "";
  const tickColor = imageOverlay
    ? tick === "read"
      ? colors.tickRead
      : colors.textInverse
    : tick === "read"
      ? colors.tickRead
      : colors.tickSent;

  const row = (
    <>
      <Text style={timeStyle}>{time}</Text>
      {showDeletedTick ? (
        <DeletedMessageTick
          color={imageOverlay ? colors.textInverse : colors.tickSent}
        />
      ) : null}
      {mine && tick === "sending" ? (
        <View
          style={{
            width: 16,
            height: 15,
            marginLeft: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons
            name="time-outline"
            size={14}
            color={tickColor}
            style={{ opacity: imageOverlay ? 0.9 : 0.72 }}
          />
        </View>
      ) : null}
      {mine && tick && tick !== "sending" && !showDeletedTick ? (
        <MessageTicks
          color={tickColor}
          double={tick === "delivered" || tick === "read"}
        />
      ) : null}
    </>
  );

  if (bare) {
    return (
      <View
        style={styles.bubbleMetaRow}
        accessibilityLabel={mine && tick ? `${time}, ${tickLabel}` : time}
      >
        {row}
      </View>
    );
  }

  return (
    <View
      style={[styles.bubbleMeta, styles.bubbleMetaRow]}
      accessibilityLabel={mine && tick ? `${time}, ${tickLabel}` : time}
    >
      {row}
    </View>
  );
}
