import { DocumentListGlyph } from "@/components/messages/DocumentListGlyph";
import type { ThemeColors } from "@/lib/theme/colors";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export type PendingImageAsset = {
  uri: string;
  width: number;
  height: number;
  contentType: string;
};

type ComposerStyles = {
  composerInput: StyleProp<TextStyle>;
  sendBtn: StyleProp<ViewStyle>;
};

export type PendingDocumentCaption = {
  fileName: string;
  previewUri: string | null;
};

export type PendingMoneyCaption = {
  amountLabel: string;
  fruitEmoji?: string;
};

type Props = {
  assets?: PendingImageAsset[] | null;
  document?: PendingDocumentCaption | null;
  money?: PendingMoneyCaption | null;
  colors: ThemeColors;
  styles: ComposerStyles;
  onCancel: () => void;
  onSend: (caption: string) => void;
};

const THUMB = 44;

/** Barre légende + miniature (style WhatsApp), dans le composer du fil. */
export function ImageCaptionComposer({
  assets,
  document,
  money,
  colors,
  styles,
  onCancel,
  onSend,
}: Props) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState("");
  const inputRef = useRef<TextInput>(null);
  const local = useMemo(() => createLocalStyles(colors), [colors]);

  useEffect(() => {
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(focusTimer);
  }, []);

  const imageAssets = assets ?? [];
  const first = imageAssets[0];
  const extra = imageAssets.length > 1 ? imageAssets.length - 1 : 0;
  const doc = document ?? null;
  const moneyPreview = money ?? null;

  const handleSend = () => {
    onSend(caption.trim());
    setCaption("");
  };

  if (!first && !doc && !moneyPreview) return null;

  return (
    <View style={local.row}>
      <View style={local.thumbWrap}>
        {moneyPreview ? (
          moneyPreview.fruitEmoji ? (
            <View style={[local.thumb, local.fruitMoneyThumb]}>
              <Text style={local.fruitMoneyEmoji}>
                {moneyPreview.fruitEmoji}
              </Text>
            </View>
          ) : (
            <View style={[local.thumb, local.moneyThumb]}>
              <Text style={local.moneyEmoji}>💰</Text>
              <Text style={local.moneyAmount} numberOfLines={1}>
                {moneyPreview.amountLabel}
              </Text>
            </View>
          )
        ) : doc ? (
          doc.previewUri ? (
            <Image
              source={{ uri: doc.previewUri }}
              style={local.thumb}
              contentFit="cover"
            />
          ) : (
            <View style={[local.thumb, local.docThumbFallback]}>
              <DocumentListGlyph color={colors.textMuted} />
            </View>
          )
        ) : (
          <Image
            source={{ uri: first!.uri }}
            style={local.thumb}
            contentFit="cover"
          />
        )}
        {!doc && !moneyPreview && extra > 0 ? (
          <View style={local.countBadge}>
            <Text style={local.countText}>+{extra}</Text>
          </View>
        ) : null}
        <Pressable
          style={local.thumbDismiss}
          onPress={onCancel}
          hitSlop={6}
          accessibilityLabel={t("common.cancel")}
        >
          <Ionicons name="close" size={14} color={colors.textInverse} />
        </Pressable>
      </View>
      <TextInput
        ref={inputRef}
        style={[styles.composerInput, local.captionInput]}
        placeholder={t("messages.imageCaptionPlaceholder")}
        placeholderTextColor={colors.placeholder}
        value={caption}
        onChangeText={setCaption}
        multiline
        maxLength={2000}
      />
      <Pressable
        style={styles.sendBtn}
        onPress={handleSend}
        accessibilityLabel={t("messages.send")}
      >
        <Ionicons name="send" size={18} color={colors.accentOn} />
      </Pressable>
    </View>
  );
}

function createLocalStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 6,
      minHeight: 42,
    },
    thumbWrap: {
      width: THUMB,
      height: THUMB,
      marginBottom: 2,
      marginLeft: 4,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: 8,
      backgroundColor: c.borderLight,
    },
    docThumbFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    moneyThumb: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 2,
    },
    fruitMoneyThumb: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      paddingHorizontal: 0,
    },
    fruitMoneyEmoji: {
      fontSize: 28,
      lineHeight: 30,
      includeFontPadding: false,
    },
    moneyEmoji: {
      fontSize: 16,
      lineHeight: 18,
    },
    moneyAmount: {
      fontSize: 8,
      fontWeight: "700",
      color: c.textMuted,
      marginTop: 1,
    },
    thumbDismiss: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.overlay,
      alignItems: "center",
      justifyContent: "center",
    },
    countBadge: {
      position: "absolute",
      bottom: 2,
      right: 2,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 6,
      backgroundColor: c.overlay,
    },
    countText: {
      fontSize: 10,
      fontWeight: "700",
      color: c.textInverse,
    },
    captionInput: {
      flex: 1,
      minHeight: 40,
      maxHeight: 100,
      paddingVertical: 8,
    },
  });
}
