import { FruitMoneyDollarGlyph } from "@/components/messages/FruitMoneyDollarGlyph";
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
  Pressable,
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
  fruitMoneyMeta,
  fruitMoneyClaimedLabel,
  /** Vocal : durée à droite, même ligne que l’heure. */
  trailingText,
  trailingTextStyle,
  moneyReceiptOn,
  moneyReceiptToggle,
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
  /** Heure jaune — fruit money uniquement. */
  fruitMoneyMeta?: boolean;
  /** Destinataire — fruit money récupéré (remplace l’heure). */
  fruitMoneyClaimedLabel?: string | null;
  trailingText?: string | null;
  trailingTextStyle?: StyleProp<TextStyle>;
  /** Reçu exigé (destinataire, en attente). */
  moneyReceiptOn?: boolean;
  /** Émetteur — activer / désactiver le reçu (transfert en attente). */
  moneyReceiptToggle?: { on: boolean; onPress: () => void; disabled?: boolean };
}) {
  const { t } = useTranslation();
  const claimedMeta = String(fruitMoneyClaimedLabel ?? "").trim();
  if (claimedMeta) {
    const claimedRow = (
      <Text
        style={[
          styles.imageMetaTime,
          {
            color: colors.textMuted,
            fontStyle: "italic",
            fontWeight: "400",
          },
        ]}
      >
        {claimedMeta}
      </Text>
    );
    if (bare) {
      return (
        <View
          style={styles.bubbleMetaRow}
          accessibilityLabel={claimedMeta}
        >
          {claimedRow}
        </View>
      );
    }
    return (
      <View
        style={[styles.bubbleMeta, styles.bubbleMetaRow]}
        accessibilityLabel={claimedMeta}
      >
        {claimedRow}
      </View>
    );
  }

  const time = formatMessageTime(createdAt);
  if (!time) return null;

  const fruitMetaYellow = colors.chatMoneyPillPressedBackground;
  const timeStyle = fruitMoneyMeta
    ? [
        imageOverlay ? styles.imageMetaTime : styles.bubbleMetaTime,
        { color: fruitMetaYellow, fontWeight: "500" },
      ]
    : imageOverlay
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
  const tickColor =
    fruitMoneyMeta
      ? fruitMetaYellow
      : imageOverlay
        ? tick === "read"
          ? colors.tickRead
          : colors.textInverse
        : tick === "read"
          ? colors.tickRead
          : colors.tickSent;

  const row = (
    <>
      {fruitMoneyMeta ? (
        <FruitMoneyDollarGlyph color={fruitMetaYellow} size={9} />
      ) : null}
      <Text style={timeStyle}>{time}</Text>
      {!fruitMoneyMeta && moneyReceiptToggle ? (
        <Pressable
          onPress={() => {
            moneyReceiptToggle.onPress();
          }}
          disabled={moneyReceiptToggle.disabled}
          hitSlop={12}
          accessibilityRole="switch"
          accessibilityState={{ checked: moneyReceiptToggle.on }}
          accessibilityLabel={t("moneyReceipt.toggleA11y")}
          style={{ marginLeft: 3, paddingVertical: 1 }}
        >
          <Ionicons
            name="receipt-outline"
            size={13}
            color={
              moneyReceiptToggle.on ? colors.accent : colors.tickSent
            }
            style={
              moneyReceiptToggle.on ? undefined : { opacity: 0.72 }
            }
          />
        </Pressable>
      ) : !fruitMoneyMeta && moneyReceiptOn ? (
        <View
          style={{ marginLeft: 3, paddingVertical: 1 }}
          accessibilityLabel={t("moneyReceipt.badgeA11y")}
        >
          <Ionicons name="receipt-outline" size={13} color={colors.accent} />
        </View>
      ) : null}
      {showDeletedTick ? (
        <DeletedMessageTick
          color={
            fruitMoneyMeta && imageOverlay
              ? fruitMetaYellow
              : imageOverlay
                ? colors.textInverse
                : colors.tickSent
          }
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

  const trail = String(trailingText ?? "").trim();
  const a11y =
    trail && mine && tick
      ? `${time}, ${trail}, ${tickLabel}`
      : trail
        ? `${time}, ${trail}`
        : mine && tick
          ? `${time}, ${tickLabel}`
          : time;

  const metaLine = trail ? (
    <View
      style={[
        styles.bubbleMetaRow,
        { width: "100%", justifyContent: "space-between" },
      ]}
    >
      <View style={styles.bubbleMetaRow}>{row}</View>
      <Text style={trailingTextStyle} accessibilityElementsHidden>
        {trail}
      </Text>
    </View>
  ) : (
    row
  );

  if (bare) {
    return (
      <View style={styles.bubbleMetaRow} accessibilityLabel={a11y}>
        {metaLine}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.bubbleMeta,
        trail ? { alignSelf: "stretch", width: "100%" } : styles.bubbleMetaRow,
      ]}
      accessibilityLabel={a11y}
    >
      {metaLine}
    </View>
  );
}
